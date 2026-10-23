import type { FilePurpose } from '@school-sync/shared';

/**
 * Content sniffing for uploads. The client-declared MIME type and the extension are never trusted: the type is decided
 * from the file's leading bytes, then it must be allowed for the upload purpose AND be consistent with the extension.
 */

export const SNIFF_BYTES = 4096;

export interface Detected {
  /** canonical MIME type we will store and serve; null when the bytes match nothing we accept */
  mime: string | null;
  /** extensions that are legitimate for that type (lower-case, no dot) */
  exts: readonly string[];
  /** what the bytes look like, for error messages / logs */
  family: 'image' | 'pdf' | 'office' | 'text' | 'archive' | 'executable' | 'markup' | 'unknown';
}

const OOXML: Record<string, { mime: string; ext: string }> = {
  docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ext: 'docx' },
  xlsx: { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext: 'xlsx' },
  pptx: { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', ext: 'pptx' },
};
const OLE: Record<string, string> = { doc: 'application/msword', xls: 'application/vnd.ms-excel', ppt: 'application/vnd.ms-powerpoint' };

const startsWith = (b: Buffer, sig: number[], at = 0) => b.length >= at + sig.length && sig.every((v, i) => b[at + i] === v);
const ascii = (b: Buffer, from: number, to: number) => b.subarray(from, to).toString('latin1');
const extOf = (name: string) => (name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '');

/** Name of the first entry of a ZIP container (local file header at offset 0), or null. */
function firstZipEntry(b: Buffer): string | null {
  if (b.length < 30) return null;
  const len = b.readUInt16LE(26);
  if (b.length < 30 + len) return null;
  return b.subarray(30, 30 + len).toString('utf8');
}

function looksLikeText(b: Buffer): boolean {
  if (!b.length) return false;
  if (b.includes(0)) return false;
  try {
    // `stream: true` tolerates a multi-byte character cut by the end of the sniffed window
    new TextDecoder('utf-8', { fatal: true }).decode(b, { stream: true });
  } catch {
    return false;
  }
  let ctrl = 0;
  for (const c of b) if (c < 9 || (c > 13 && c < 32)) ctrl++;
  return ctrl === 0;
}

export function detect(head: Buffer, filename: string): Detected {
  const ext = extOf(filename);

  // executables & scripts first: never acceptable, whatever the name claims
  if (startsWith(head, [0x7f, 0x45, 0x4c, 0x46])) return { mime: null, exts: [], family: 'executable' }; // ELF
  if (startsWith(head, [0x4d, 0x5a])) return { mime: null, exts: [], family: 'executable' }; // PE / DOS "MZ"
  if (startsWith(head, [0xca, 0xfe, 0xba, 0xbe]) || startsWith(head, [0xfe, 0xed, 0xfa, 0xce]) || startsWith(head, [0xfe, 0xed, 0xfa, 0xcf]) || startsWith(head, [0xce, 0xfa, 0xed, 0xfe]) || startsWith(head, [0xcf, 0xfa, 0xed, 0xfe])) {
    return { mime: null, exts: [], family: 'executable' }; // Mach-O / Java class
  }
  if (startsWith(head, [0x23, 0x21])) return { mime: null, exts: [], family: 'executable' }; // "#!" shebang script

  // images
  if (startsWith(head, [0xff, 0xd8, 0xff])) return { mime: 'image/jpeg', exts: ['jpg', 'jpeg', 'jpe', 'jfif'], family: 'image' };
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { mime: 'image/png', exts: ['png'], family: 'image' };
  if (ascii(head, 0, 6) === 'GIF87a' || ascii(head, 0, 6) === 'GIF89a') return { mime: 'image/gif', exts: ['gif'], family: 'image' };
  if (ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 12) === 'WEBP') return { mime: 'image/webp', exts: ['webp'], family: 'image' };
  if (ascii(head, 4, 8) === 'ftyp' && ['heic', 'heix', 'hevc', 'heim', 'heis', 'mif1', 'msf1'].includes(ascii(head, 8, 12))) return { mime: 'image/heic', exts: ['heic', 'heif'], family: 'image' };

  // documents
  if (ascii(head, 0, 5) === '%PDF-') return { mime: 'application/pdf', exts: ['pdf'], family: 'pdf' };
  if (startsWith(head, [0x50, 0x4b, 0x03, 0x04])) {
    const first = firstZipEntry(head);
    const ooxmlFirst = first !== null && (first === '[Content_Types].xml' || first.startsWith('_rels/') || first.startsWith('docProps/') || first.startsWith('word/') || first.startsWith('xl/') || first.startsWith('ppt/'));
    const t = OOXML[ext];
    if (ooxmlFirst && t) return { mime: t.mime, exts: [t.ext], family: 'office' };
    return { mime: null, exts: [], family: 'archive' };
  }
  if (startsWith(head, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
    const mime = OLE[ext];
    return mime ? { mime, exts: [ext], family: 'office' } : { mime: null, exts: [], family: 'archive' };
  }

  // markup / script-bearing text (HTML, SVG, XML, PHP …): anything that starts with "<" after BOM + whitespace
  const text = head.toString('utf8').replace(/^﻿/, '').trimStart();
  if (text.startsWith('<')) return { mime: null, exts: [], family: 'markup' };

  if (looksLikeText(head)) {
    if (ext === 'csv') return { mime: 'text/csv', exts: ['csv'], family: 'text' };
    return { mime: 'text/plain', exts: ['txt'], family: 'text' };
  }
  return { mime: null, exts: [], family: 'unknown' };
}

const IMAGES_BASIC = ['image/jpeg', 'image/png', 'image/webp'];
const IMAGES = [...IMAGES_BASIC, 'image/gif', 'image/heic'];
const DOCS = [
  'application/pdf',
  OOXML.docx!.mime,
  OOXML.xlsx!.mime,
  OOXML.pptx!.mime,
  OLE.doc!,
  OLE.xls!,
  OLE.ppt!,
  'text/plain',
  'text/csv',
];

/** Content types allowed per purpose (positive allow-list: anything else is refused). */
export const ALLOWED_MIME: Record<FilePurpose, readonly string[]> = {
  avatar: IMAGES_BASIC,
  homework: [...IMAGES, ...DOCS],
  submission: [...IMAGES, ...DOCS],
  material: [...IMAGES, ...DOCS],
  document: [...IMAGES, ...DOCS],
  announcement: [...IMAGES, ...DOCS],
  receipt: [...IMAGES, 'application/pdf'],
  other: [...IMAGES, ...DOCS],
};

/** Per-purpose size caps in MB (the effective cap is `min(this, MAX_UPLOAD_MB)`). */
export const PURPOSE_MAX_MB: Partial<Record<FilePurpose, number>> = { avatar: 5 };

/** Types a browser can safely render inline; everything else is offered as a download. */
export const INLINE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf']);

const BLOCKED_EXT = new Set([
  'exe', 'dll', 'bat', 'cmd', 'com', 'msi', 'scr', 'pif', 'sh', 'bash', 'zsh', 'csh', 'js', 'mjs', 'cjs', 'jse', 'vbs', 'vbe', 'wsf', 'ps1', 'psm1', 'jar', 'apk', 'ipa', 'app', 'php', 'phtml', 'py', 'pl', 'rb', 'cgi', 'html', 'htm', 'xhtml', 'shtml', 'svg', 'svgz', 'xml', 'xsl', 'swf', 'hta', 'lnk', 'reg', 'iso', 'dmg', 'docm', 'xlsm', 'pptm', 'dotm', 'xlam', 'class', 'so', 'bin',
]);

export class UploadRejected extends Error {
  constructor(
    public readonly code: 'FILE_TYPE_NOT_ALLOWED' | 'FILE_EXTENSION_MISMATCH' | 'FILE_EMPTY',
    message: string,
    public readonly detected?: string,
  ) {
    super(message);
  }
}

/**
 * Decide whether `head` (the first bytes) + `filename` is acceptable for `purpose`.
 * Returns the canonical MIME type to store, or throws `UploadRejected`.
 */
export function assertAllowed(head: Buffer, filename: string, purpose: FilePurpose): { mime: string; ext: string } {
  if (!head.length) throw new UploadRejected('FILE_EMPTY', 'The uploaded file is empty');
  const ext = extOf(filename);
  const d = detect(head, filename);
  if (BLOCKED_EXT.has(ext) || d.family === 'executable' || d.family === 'markup') {
    throw new UploadRejected('FILE_TYPE_NOT_ALLOWED', 'This type of file cannot be uploaded', d.family);
  }
  if (!d.mime || !ALLOWED_MIME[purpose].includes(d.mime)) {
    throw new UploadRejected('FILE_TYPE_NOT_ALLOWED', `This type of file is not allowed for "${purpose}" uploads`, d.mime ?? d.family);
  }
  if (ext && !d.exts.includes(ext)) {
    throw new UploadRejected('FILE_EXTENSION_MISMATCH', `The file extension ".${ext}" does not match its content (${d.mime})`, d.mime);
  }
  return { mime: d.mime, ext: d.exts[0]! };
}

/** Safe display name: no path parts, control characters or reserved characters; extension forced to match the content. */
export function sanitizeFileName(raw: string | undefined, fallbackExt: string): string {
  let name = (raw ?? '').normalize('NFC');
  name = name.split(/[\\/]/).pop() ?? '';
  name = name.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '').replace(/\s+/g, ' ').trim().replace(/^\.+/, '');
  if (name.length > 150) {
    const e = extOf(name);
    const base = e ? name.slice(0, name.length - e.length - 1) : name;
    name = `${base.slice(0, 140)}${e ? `.${e.slice(0, 8)}` : ''}`;
  }
  if (!name) return `file.${fallbackExt}`;
  return extOf(name) ? name : `${name}.${fallbackExt}`;
}
