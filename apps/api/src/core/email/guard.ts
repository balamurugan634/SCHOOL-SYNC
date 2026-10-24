import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { EMAIL_ALLOWED_PORTS } from '@school-sync/shared';
import { config } from '../../config';
import { emailTestHooks } from './test-hooks';

/**
 * SSRF guard for school-supplied SMTP hosts. A school admin picks the host and port, so without this the API server would
 * happily connect to 127.0.0.1:5432, the cloud metadata service (169.254.169.254) or anything on the private network.
 *
 *  - port must be 25, 465, 587 or 2525
 *  - the host is resolved HERE and every address must be public (IPv4 + IPv6, incl. IPv4-mapped / NAT64 / 6to4 forms)
 *  - the caller then connects to the RESOLVED ADDRESS (with the host name only as TLS server name), so a DNS answer that
 *    changes between the check and the connect (rebinding) cannot redirect the connection
 *
 * ALLOW_PRIVATE_SMTP=true (dev/test only; refused in production) switches the address and port checks off.
 */

export type SmtpTargetErrorCode = 'PORT_NOT_ALLOWED' | 'HOST_NOT_FOUND' | 'HOST_BLOCKED';

export class SmtpTargetError extends Error {
  constructor(
    public readonly code: SmtpTargetErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SmtpTargetError';
  }
}

export interface SmtpTarget {
  /** the name the school typed (used as TLS server name) */
  host: string;
  port: number;
  /** the validated address to connect to */
  address: string;
  family: 4 | 6;
}

type Cidr4 = readonly [string, number];
/** IPv4 ranges that must never be reached: this host, private, CGNAT, loopback, link-local (cloud metadata), test nets, multicast, reserved. */
const BLOCKED_V4: readonly Cidr4[] = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10], // carrier-grade NAT (also Alibaba metadata 100.100.100.200)
  ['127.0.0.0', 8],
  ['169.254.0.0', 16], // link-local incl. 169.254.169.254 metadata
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved + broadcast
];

const v4ToInt = (a: string): number => a.split('.').reduce((n, p) => n * 256 + Number(p), 0);
const BLOCKED_V4_INT = BLOCKED_V4.map(([base, bits]) => ({ base: v4ToInt(base), mask: bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0 }));

function isBlockedV4(addr: string): boolean {
  const n = v4ToInt(addr);
  return BLOCKED_V4_INT.some(({ base, mask }) => ((n & mask) >>> 0) === ((base & mask) >>> 0));
}

/** 16 bytes of an IPv6 address (handles `::` and a dotted IPv4 tail); null when malformed. */
function v6Bytes(addr: string): number[] | null {
  let a = addr.toLowerCase();
  const zone = a.indexOf('%');
  if (zone >= 0) a = a.slice(0, zone);
  let tail: number[] = [];
  const dot = a.lastIndexOf('.');
  if (dot >= 0) {
    const colon = a.lastIndexOf(':');
    const v4 = a.slice(colon + 1);
    if (isIP(v4) !== 4) return null;
    tail = v4.split('.').map(Number);
    a = a.slice(0, colon + 1) + '0:0';
  }
  const halves = a.split('::');
  if (halves.length > 2) return null;
  const parse = (s: string): number[] | null => {
    if (s === '') return [];
    const out: number[] = [];
    for (const g of s.split(':')) {
      if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
      const v = parseInt(g, 16);
      out.push(v >> 8, v & 0xff);
    }
    return out;
  };
  const head = parse(halves[0] ?? '');
  const rest = halves.length === 2 ? parse(halves[1] ?? '') : [];
  if (!head || !rest) return null;
  const fill = 16 - head.length - rest.length;
  if (halves.length === 2 ? fill < 0 : fill !== 0) return null;
  const bytes = [...head, ...new Array<number>(halves.length === 2 ? fill : 0).fill(0), ...rest];
  if (bytes.length !== 16) return null;
  if (tail.length) bytes.splice(12, 4, ...tail);
  return bytes;
}

const v4FromBytes = (b: number[], at: number) => `${b[at]}.${b[at + 1]}.${b[at + 2]}.${b[at + 3]}`;

function isBlockedV6(addr: string): boolean {
  const b = v6Bytes(addr);
  if (!b) return true; // unparseable: refuse
  const zeroPrefix = (n: number) => b.slice(0, n).every((x) => x === 0);
  // ::, ::1 and the deprecated IPv4-compatible ::a.b.c.d  (first 96 bits zero)
  if (zeroPrefix(12)) return true;
  // IPv4-mapped ::ffff:a.b.c.d → judge the embedded IPv4 address
  if (zeroPrefix(10) && b[10] === 0xff && b[11] === 0xff) return isBlockedV4(v4FromBytes(b, 12));
  // NAT64 64:ff9b::/96 → embedded IPv4
  if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b && b.slice(4, 12).every((x) => x === 0)) return isBlockedV4(v4FromBytes(b, 12));
  // 6to4 2002::/16 → embedded IPv4
  if (b[0] === 0x20 && b[1] === 0x02) return isBlockedV4(v4FromBytes(b, 2));
  const b0 = b[0]!;
  const b1 = b[1]!;
  if ((b0 & 0xfe) === 0xfc) return true; // unique local fc00::/7 (incl. AWS IMDS fd00:ec2::254)
  if (b0 === 0xfe && (b1 & 0xc0) === 0x80) return true; // link-local fe80::/10
  if (b0 === 0xfe && (b1 & 0xc0) === 0xc0) return true; // site-local fec0::/10 (deprecated)
  if (b0 === 0xff) return true; // multicast
  if (b0 === 0x01 && b1 === 0x00 && b.slice(2, 8).every((x) => x === 0)) return true; // discard-only 100::/64
  if (b0 === 0x20 && b1 === 0x01 && (b[2]! & 0xfe) === 0) return true; // 2001::/23 IETF protocol assignments (Teredo 2001::/32, ORCHID, …)
  if (b0 === 0x20 && b1 === 0x01 && b[2] === 0x0d && b[3] === 0xb8) return true; // documentation 2001:db8::/32
  if (b0 === 0x3f && (b1 & 0xf0) === 0xf0) return true; // documentation 3fff::/20
  return false;
}

/** True when `ip` (a literal v4 or v6 address) is loopback / private / link-local / CGNAT / metadata / reserved. Unknown strings count as blocked. */
export function isBlockedAddress(ip: string): boolean {
  const v = isIP(ip.replace(/^\[|\]$/g, ''));
  const bare = ip.replace(/^\[|\]$/g, '');
  if (v === 4) return isBlockedV4(bare);
  if (v === 6) return isBlockedV6(bare);
  return true;
}

export const smtpPortAllowed = (port: number): boolean => config.ALLOW_PRIVATE_SMTP || (EMAIL_ALLOWED_PORTS as readonly number[]).includes(port);

type Lookup = (host: string) => Promise<{ address: string; family: number }[]>;
const defaultLookup: Lookup = (host) => (emailTestHooks.lookup ?? ((h: string) => lookup(h, { all: true, verbatim: true })))(host);

const DNS_TIMEOUT_MS = 5_000;
async function resolveAll(host: string, doLookup: Lookup): Promise<{ address: string; family: number }[]> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      doLookup(host),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('dns timeout')), DNS_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Validate and resolve an SMTP host:port. Throws SmtpTargetError with a message that is safe to show to a school admin.
 * Called when settings are saved (early feedback) and again by the sender immediately before every connection.
 */
export async function resolveSmtpTarget(hostInput: string, port: number, doLookup: Lookup = defaultLookup): Promise<SmtpTarget> {
  const host = hostInput.trim().replace(/^\[|\]$/g, '');
  if (!smtpPortAllowed(port)) throw new SmtpTargetError('PORT_NOT_ALLOWED', `Port ${port} is not allowed. Use 587 (most providers), 465 (SSL), 25 or 2525.`);
  if (!host) throw new SmtpTargetError('HOST_NOT_FOUND', 'Enter the mail server name, for example smtp.gmail.com.');
  let addresses: { address: string; family: number }[];
  if (isIP(host)) {
    addresses = [{ address: host, family: isIP(host) }];
  } else {
    try {
      addresses = await resolveAll(host, doLookup);
    } catch {
      throw new SmtpTargetError('HOST_NOT_FOUND', 'That mail server name could not be found. Check the spelling of the server name.');
    }
    if (!addresses.length) throw new SmtpTargetError('HOST_NOT_FOUND', 'That mail server name could not be found. Check the spelling of the server name.');
  }
  if (!config.ALLOW_PRIVATE_SMTP && addresses.some((a) => isBlockedAddress(a.address))) {
    throw new SmtpTargetError('HOST_BLOCKED', 'That mail server address is not allowed. Use your mail provider’s public SMTP server, not an internal or local address.');
  }
  const first = addresses[0]!;
  return { host, port, address: first.address, family: first.family === 6 ? 6 : 4 };
}

/**
 * Cheap check used when saving: refuses a disallowed port and a host that is (or resolves to) a blocked address.
 * A name that does not resolve right now is accepted (DNS can be flaky); the test email reports it.
 */
export async function assertSmtpTargetAllowed(host: string, port: number, doLookup: Lookup = defaultLookup): Promise<void> {
  try {
    await resolveSmtpTarget(host, port, doLookup);
  } catch (e) {
    if (e instanceof SmtpTargetError && e.code === 'HOST_NOT_FOUND') return;
    throw e;
  }
}
