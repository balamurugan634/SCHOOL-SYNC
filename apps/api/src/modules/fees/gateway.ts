import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { isProd } from '../../config';

/**
 * Online-payment gateways.
 *
 *  - `mock`     for development and tests. It is REFUSED in production (`isProd`), so a leaked mock secret can never
 *               mark a real invoice paid.
 *  - `razorpay` HTTP adapter written from the public Razorpay documentation. It is NOT TESTED against the live (or
 *               test-mode) Razorpay API: no account / network was available while it was written. Before enabling it for
 *               a school, run a test-mode payment end to end (order creation, checkout, webhook delivery, refund).
 *
 * Configuration (environment, read lazily so tests can change it):
 *   PAYMENT_GATEWAY            mock | razorpay        (default: razorpay when keys exist, else mock outside production)
 *   RAZORPAY_KEY_ID            public key id (also sent to the client for the checkout widget)
 *   RAZORPAY_KEY_SECRET        API secret (server only)
 *   RAZORPAY_WEBHOOK_SECRET    secret configured on the Razorpay webhook (HMAC-SHA256 of the raw body)
 *   MOCK_GATEWAY_SECRET        mock webhook secret (default "mock-gateway-secret")
 */

export type GatewayName = 'mock' | 'razorpay';

export interface GatewayOrder {
  orderId: string;
  amountMinor: number;
  currency: string;
  /** public key for the client-side checkout widget; never a secret */
  keyId: string | null;
}

export interface GatewayEvent {
  kind: 'payment.succeeded' | 'payment.failed' | 'ignored';
  orderId: string | null;
  paymentId: string | null;
  amountMinor: number | null;
  currency: string | null;
  /** metadata we attached to the order when creating it (tenant code, local payment id, invoice id) */
  notes: Record<string, string>;
}

export interface GatewayPayment {
  paymentId: string;
  orderId: string;
  status: 'captured' | 'failed' | 'pending';
  amountMinor: number;
  currency: string;
}

export interface PaymentGateway {
  readonly name: GatewayName;
  isConfigured(): boolean;
  createOrder(input: { amountMinor: number; currency: string; receipt: string; notes: Record<string, string> }): Promise<GatewayOrder>;
  /** constant-time check of the webhook signature header against the RAW request body */
  verifyWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): boolean;
  parseWebhook(rawBody: Buffer): GatewayEvent;
  /** server-to-server lookup of the (captured) payment for an order; used to reconcile a delayed webhook */
  fetchPayment(ref: { orderId: string }): Promise<GatewayPayment | null>;
  /** return money to the payer (online payments only) */
  refund?(input: { gatewayPaymentId: string; amountMinor: number; notes?: Record<string, string> }): Promise<{ id: string }>;
}

const header = (h: Record<string, string | string[] | undefined>, name: string): string => {
  const v = h[name];
  return Array.isArray(v) ? (v[0] ?? '') : (v ?? '');
};
const safeHexEqual = (a: string, b: string): boolean => {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  return ab.length === bb.length && timingSafeEqual(ab, bb);
};
const hmacHex = (secret: string, body: Buffer): string => createHmac('sha256', secret).update(body).digest('hex');

// Both gateways deliver the Razorpay event shape, so one parser serves both.
function parseRazorpayShape(rawBody: Buffer): GatewayEvent {
  const ignored: GatewayEvent = { kind: 'ignored', orderId: null, paymentId: null, amountMinor: null, currency: null, notes: {} };
  let json: any;
  try {
    json = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return ignored;
  }
  const event = String(json?.event ?? '');
  const entity = json?.payload?.payment?.entity ?? json?.payload?.order?.entity;
  const pay = json?.payload?.payment?.entity;
  const orderNotes = json?.payload?.order?.entity?.notes;
  const notes = { ...(typeof orderNotes === 'object' && orderNotes ? orderNotes : {}), ...(typeof pay?.notes === 'object' && pay?.notes ? pay.notes : {}) } as Record<string, string>;
  if (!entity) return { ...ignored, notes };
  const base = {
    orderId: (pay?.order_id ?? json?.payload?.order?.entity?.id ?? null) as string | null,
    paymentId: (pay?.id ?? null) as string | null,
    amountMinor: typeof (pay?.amount ?? entity.amount) === 'number' ? ((pay?.amount ?? entity.amount) as number) : null,
    currency: (pay?.currency ?? entity.currency ?? null) as string | null,
    notes,
  };
  if (event === 'payment.captured' || event === 'order.paid') return { kind: 'payment.succeeded', ...base };
  if (event === 'payment.failed') return { kind: 'payment.failed', ...base };
  return { kind: 'ignored', ...base };
}

// ── mock (dev / tests) ──────────────────────────────────────────────────────────────────────

const MOCK_KEY = 'mock_key_id';
const mockSign = (body: Buffer): string => hmacHex(process.env.MOCK_GATEWAY_SECRET || 'mock-gateway-secret', body);
const mockCaptured = new Map<string, GatewayPayment>();

export const mockGateway: PaymentGateway & { sign(body: Buffer): string; capture(order: { orderId: string; amountMinor: number; currency: string; notes: Record<string, string> }): { body: Buffer; signature: string } } = {
  name: 'mock',
  isConfigured: () => !isProd,
  async createOrder(i) {
    return { orderId: `order_mock_${randomBytes(9).toString('hex')}`, amountMinor: i.amountMinor, currency: i.currency, keyId: MOCK_KEY };
  },
  sign: mockSign,
  verifyWebhook(rawBody, headers) {
    if (isProd) return false;
    return safeHexEqual(header(headers, 'x-mock-signature'), mockSign(rawBody));
  },
  parseWebhook: parseRazorpayShape,
  async fetchPayment({ orderId }) {
    return mockCaptured.get(orderId) ?? null;
  },
  async refund() {
    return { id: `rfnd_mock_${randomBytes(6).toString('hex')}` };
  },
  /** Build the signed webhook a real gateway would send once the payer completes checkout (dev/test helper). */
  capture(order) {
    const payment: GatewayPayment = { paymentId: `pay_mock_${randomBytes(9).toString('hex')}`, orderId: order.orderId, status: 'captured', amountMinor: order.amountMinor, currency: order.currency };
    mockCaptured.set(order.orderId, payment);
    const body = Buffer.from(
      JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: payment.paymentId, order_id: order.orderId, amount: order.amountMinor, currency: order.currency, status: 'captured', notes: order.notes } } } }),
    );
    return { body, signature: mockSign(body) };
  },
};

// ── Razorpay (UNTESTED against the live API) ────────────────────────────────────────────────

const RZP = 'https://api.razorpay.com/v1';
const rzpAuth = () => `Basic ${Buffer.from(`${process.env.RAZORPAY_KEY_ID ?? ''}:${process.env.RAZORPAY_KEY_SECRET ?? ''}`).toString('base64')}`;

async function rzp<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${RZP}${path}`, { method, headers: { Authorization: rzpAuth(), 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
  const text = await res.text();
  if (!res.ok) throw new Error(`Razorpay ${method} ${path} failed: ${res.status} ${text.slice(0, 300)}`);
  return JSON.parse(text) as T;
}

export const razorpayGateway: PaymentGateway = {
  name: 'razorpay',
  isConfigured: () => !!(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET && process.env.RAZORPAY_WEBHOOK_SECRET),
  async createOrder(i) {
    const o = await rzp<{ id: string; amount: number; currency: string }>('POST', '/orders', { amount: i.amountMinor, currency: i.currency, receipt: i.receipt.slice(0, 40), notes: i.notes });
    return { orderId: o.id, amountMinor: o.amount, currency: o.currency, keyId: process.env.RAZORPAY_KEY_ID ?? null };
  },
  verifyWebhook(rawBody, headers) {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    const sig = header(headers, 'x-razorpay-signature');
    if (!secret || !sig) return false;
    return safeHexEqual(sig, hmacHex(secret, rawBody));
  },
  parseWebhook: parseRazorpayShape,
  async fetchPayment({ orderId }) {
    const r = await rzp<{ items: { id: string; order_id: string; status: string; amount: number; currency: string }[] }>('GET', `/orders/${encodeURIComponent(orderId)}/payments`);
    const p = r.items.find((x) => x.status === 'captured') ?? r.items[0];
    if (!p) return null;
    return { paymentId: p.id, orderId: p.order_id, status: p.status === 'captured' ? 'captured' : p.status === 'failed' ? 'failed' : 'pending', amountMinor: p.amount, currency: p.currency };
  },
  async refund(i) {
    const r = await rzp<{ id: string }>('POST', `/payments/${encodeURIComponent(i.gatewayPaymentId)}/refund`, { amount: i.amountMinor, notes: i.notes });
    return { id: r.id };
  },
};

/** The gateway in use, or null when none is usable (e.g. production without Razorpay keys). */
export function activeGateway(): PaymentGateway | null {
  const wanted = process.env.PAYMENT_GATEWAY as GatewayName | undefined;
  if (wanted === 'razorpay') return razorpayGateway.isConfigured() ? razorpayGateway : null;
  if (wanted === 'mock') return mockGateway.isConfigured() ? mockGateway : null;
  if (razorpayGateway.isConfigured()) return razorpayGateway;
  return mockGateway.isConfigured() ? mockGateway : null;
}

export function gatewayByName(name: string): PaymentGateway | null {
  if (name === 'razorpay') return razorpayGateway.isConfigured() ? razorpayGateway : null;
  if (name === 'mock') return mockGateway.isConfigured() ? mockGateway : null;
  return null;
}
