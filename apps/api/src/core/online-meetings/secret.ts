import { openForTenant, sealForTenant } from '../email/secret';

/**
 * Provider credentials and host links are sealed like the email passwords (AES-256-GCM, per-school HKDF key, random IV, the
 * row they belong to bound in as additional authenticated data) but under their own key purpose, so an email ciphertext can
 * never be opened as a meeting secret or the other way round. Never log, return or audit either side of these functions.
 */
const PURPOSE = 'meeting-secret';

export const sealCredentials = (plain: string, tenantId: string, integrationId: string): string => sealForTenant(plain, tenantId, `meeting-integration:${integrationId}`, PURPOSE);
export const openCredentials = (boxed: string, tenantId: string, integrationId: string): string => openForTenant(boxed, tenantId, `meeting-integration:${integrationId}`, PURPOSE);

/** The host (start) link of one event / meeting. `kind` and `rowId` bind it to its row. */
export const sealStartUrl = (url: string, tenantId: string, kind: 'event' | 'meeting', rowId: string): string => sealForTenant(url, tenantId, `${kind}-start-url:${rowId}`, PURPOSE);
export const openStartUrl = (boxed: string, tenantId: string, kind: 'event' | 'meeting', rowId: string): string | null => {
  try {
    return openForTenant(boxed, tenantId, `${kind}-start-url:${rowId}`, PURPOSE);
  } catch {
    return null; // key rotated or ciphertext moved: the host link is simply not shown
  }
};
