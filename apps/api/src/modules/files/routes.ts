import { eq, sql } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { avatarResponse, fileDownloadQuery, fileUploadForm, fileUploadQuery, fileUploadResponse, idParam, okSchema, problemSchema } from '@school-sync/shared';
import { actorOf, audit } from '../../core/audit';
import { AppError, conflict, forbidden, notFound, unprocessable } from '../../core/errors';
import { storage, StorageNotFoundError } from '../../core/storage';
import { files } from '../../db/tenant/schema';
import { requireAuth } from '../../plugins/guards';
import { canReadFile, isFileReferenced } from './access';
import { assertMayUpload, contentDisposition, findFile, isPurpose, parseRange, setAvatar, storeUpload, toFileObject, toUploadResponse } from './service';
import { INLINE_MIME } from './sniff';

const tag = ['Files'];
const sqlClearAvatar = (fileId: string) => sql`update users set avatar_file_id = null where avatar_file_id = ${fileId}`;
/** multipart requests have no parsed body; give the (documentation-only) body schema a placeholder to validate */
const multipartBodyHook = async (req: FastifyRequest) => {
  if (req.isMultipart()) (req as { body: unknown }).body = { file: 'multipart' };
};
const LOGO_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const binary = z.any().meta({ type: 'string', format: 'binary' });
const uploadLimit = { rateLimit: { max: 60, timeWindow: '1 minute' } };

const routes: FastifyPluginAsyncZod = async (app) => {
  /** Reads the single `file` part of the request (purpose must already be known when it is an upload). */
  async function readFilePart(req: FastifyRequest) {
    if (!req.isMultipart()) throw new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Send the file as multipart/form-data with a "file" field');
    const part = await req.file({ throwFileSizeLimit: false });
    if (!part || part.fieldname !== 'file') throw unprocessable('A multipart "file" field is required', 'FILE_REQUIRED');
    return part;
  }

  app.post(
    '/files',
    {
      preValidation: [multipartBodyHook],
      preHandler: [requireAuth],
      config: uploadLimit,
      schema: {
        tags: tag,
        summary: 'Upload a file (multipart: field `file`, plus `purpose`)',
        description:
          'Send `multipart/form-data` with a `file` part. `purpose` may be a query parameter or a form field — as a form field it must come BEFORE the `file` part. ' +
          'The content type is decided from the file bytes (not the client-declared type) and must be on the allow-list for the purpose: avatar → JPEG/PNG/WebP (max 5 MB); every other purpose → images (JPEG/PNG/WebP/GIF/HEIC) and documents (PDF, DOC/DOCX, XLS/XLSX, PPT/PPTX, TXT, CSV). ' +
          'Executables, scripts, HTML/SVG and macro-enabled Office files are always refused. The size limit is the school-wide upload limit (default 15 MB). ' +
          'Who may upload which purpose: avatar/other → any signed-in user; homework → homework:create|edit; submission → submissions:create; material → materials:create|edit; ' +
          'document → student_documents:create | leave:create | admissions:create | students:edit; announcement → announcements|events create|edit; receipt → payments|expenses|fees create. ' +
          'Use the returned `attachment` object as an element of the `attachments` arrays of homework, submissions, announcements.',
        consumes: ['multipart/form-data'],
        querystring: fileUploadQuery,
        body: fileUploadForm,
        response: { 201: fileUploadResponse },
      },
    },
    async (req, reply) => {
      const part = await readFilePart(req);
      const field = part.fields.purpose;
      // a form field only counts when it was sent before the file part (deterministic regardless of file size)
      const keys = Object.keys(part.fields);
      const early = keys.indexOf('purpose') !== -1 && keys.indexOf('purpose') < keys.indexOf('file');
      const fromField = early && field && !Array.isArray(field) && 'value' in field ? field.value : undefined;
      const purpose = req.query.purpose ?? fromField;
      if (!purpose) throw unprocessable('`purpose` is required — pass it as ?purpose= or as a form field sent before the file', 'PURPOSE_REQUIRED');
      if (!isPurpose(purpose)) throw unprocessable('Unknown file purpose', 'PURPOSE_INVALID');
      assertMayUpload(req.auth, purpose);
      const row = await storeUpload(req.db, req.tenant, req.auth, { stream: part.file, wasTruncated: () => part.file.truncated, filename: part.filename, purpose });
      return reply.status(201).send(toUploadResponse(row));
    },
  );

  app.get(
    '/files/:id',
    {
      preHandler: [requireAuth],
      // byte ranges and ETags must describe the stored bytes, so never transform them on the way out
      compress: false,
      schema: {
        tags: tag,
        summary: 'Download / stream a file',
        description:
          'Streams the bytes with the detected `Content-Type`, `X-Content-Type-Options: nosniff`, `Cache-Control: private` and an `ETag` (sha-256). Supports a single `Range: bytes=a-b` request. ' +
          'Images and PDFs are `inline`, everything else `attachment` (use `?download=1` to force a download). Callers who may not see the file get 404.',
        params: idParam,
        querystring: fileDownloadQuery,
        response: { 200: binary.describe('the file bytes'), 206: binary.describe('the requested byte range'), 304: z.undefined().describe('not modified'), 416: problemSchema },
      },
    },
    async (req, reply) => {
      const file = await findFile(req.db, req.params.id);
      if (!file || !(await canReadFile(req.auth, req.db, file))) throw notFound('File');
      if (!file.storageKey.startsWith(`${req.tenant.code}/`)) throw notFound('File'); // defence in depth: never serve another school's key
      const size = file.sizeBytes;
      const etag = `"${file.sha256 ?? file.id}"`;
      const kind = !req.query.download && INLINE_MIME.has(file.mimeType) ? 'inline' : 'attachment';
      void reply
        .header('Content-Type', file.mimeType)
        .header('Content-Disposition', contentDisposition(kind, file.originalName))
        .header('X-Content-Type-Options', 'nosniff')
        .header('Cache-Control', 'private, max-age=3600')
        .header('Accept-Ranges', 'bytes')
        .header('ETag', etag)
        .header('Content-Security-Policy', "default-src 'none'; sandbox")
        .header('Cross-Origin-Resource-Policy', 'same-site');
      if (req.headers['if-none-match'] === etag) return reply.status(304).send();
      const range = parseRange(req.headers.range, size);
      if (range === 'invalid') return reply.status(416).header('Content-Range', `bytes */${size}`).send();
      try {
        if (range) {
          const body = await storage().stream(file.storageKey, range);
          return reply.status(206).header('Content-Range', `bytes ${range.start}-${range.end}/${size}`).header('Content-Length', range.end - range.start + 1).send(body);
        }
        const body = await storage().stream(file.storageKey);
        return reply.header('Content-Length', size).send(body);
      } catch (e) {
        if (e instanceof StorageNotFoundError) {
          req.log.error({ fileId: file.id }, 'file row exists but the stored object is missing');
          throw notFound('File');
        }
        throw e;
      }
    },
  );

  /**
   * Public (no session): the login and landing pages show the school's logo before anyone signs in. Serves ONLY the file
   * named by the school's branding (`logoFileId`, set by the settings module) and only if it is a web image — never an
   * arbitrary file id (`/files/:id` stays private).
   */
  app.get(
    '/site/logo',
    {
      compress: false,
      schema: {
        tags: ['Site'],
        summary: 'The school’s logo image (public, cached 5 minutes)',
        description: 'No authentication. 404 when the school has no logo. Only JPEG / PNG / WebP / GIF are served.',
        response: { 200: binary.describe('the logo image'), 304: z.undefined().describe('not modified'), 404: problemSchema },
      },
    },
    async (req, reply) => {
      const id = req.tenant.branding.logoFileId;
      if (!id) throw notFound('Logo');
      const file = await findFile(req.db, id);
      if (!file || file.deletedAt || !LOGO_MIME.has(file.mimeType) || !file.storageKey.startsWith(`${req.tenant.code}/`)) throw notFound('Logo');
      const etag = `"${file.sha256 ?? file.id}"`;
      void reply
        .header('Content-Type', file.mimeType)
        .header('Content-Disposition', contentDisposition('inline', file.originalName))
        .header('X-Content-Type-Options', 'nosniff')
        .header('Cache-Control', 'public, max-age=300')
        .header('Cross-Origin-Resource-Policy', 'cross-origin')
        .header('Content-Security-Policy', "default-src 'none'; sandbox")
        .header('ETag', etag);
      if (req.headers['if-none-match'] === etag) return reply.status(304).send();
      try {
        return reply.header('Content-Length', file.sizeBytes).send(await storage().stream(file.storageKey));
      } catch (e) {
        if (e instanceof StorageNotFoundError) throw notFound('Logo');
        throw e;
      }
    },
  );

  app.delete(
    '/files/:id',
    {
      preHandler: [requireAuth],
      schema: {
        tags: tag,
        summary: 'Delete a file (soft delete)',
        description: 'The uploader or a school administrator (settings:edit at school scope) may delete. The uploader cannot delete a file that is still attached to a record (409 FILE_IN_USE). The bytes are purged after 30 days.',
        params: idParam,
        response: { 200: okSchema },
      },
    },
    async (req) => {
      const p = req.auth;
      const file = await findFile(req.db, req.params.id);
      if (!file || file.deletedAt) throw notFound('File');
      const isUploader = file.uploadedBy === p.userId;
      const isAdmin = p.can('settings:edit', 'school');
      if (!isUploader && !isAdmin) {
        if (!(await canReadFile(p, req.db, file))) throw notFound('File');
        throw forbidden('Only the uploader or an administrator can delete this file');
      }
      if (!isAdmin && (await isFileReferenced(req.db, file.id))) throw conflict('This file is attached to a record; remove it from there first', 'FILE_IN_USE');
      await req.db.transaction(async (tx) => {
        await tx.update(files).set({ deletedAt: new Date() }).where(eq(files.id, file.id));
        await tx.execute(sqlClearAvatar(file.id));
        await audit(tx, actorOf(req), { action: 'file.delete', entity: 'file', entityId: file.id, summary: file.originalName, before: { purpose: file.purpose, uploadedBy: file.uploadedBy } });
      });
      return { ok: true as const };
    },
  );

  // ── avatar ─────────────────────────────────────────────────────────────────
  app.put(
    '/me/avatar',
    {
      preValidation: [multipartBodyHook],
      preHandler: [requireAuth],
      config: uploadLimit,
      schema: {
        tags: ['Files', 'Auth'],
        summary: 'Set my profile picture (multipart field `file`; JPEG/PNG/WebP, max 5 MB)',
        consumes: ['multipart/form-data'],
        body: fileUploadForm,
        response: { 200: avatarResponse },
      },
    },
    async (req) => {
      const part = await readFilePart(req);
      const row = await storeUpload(req.db, req.tenant, req.auth, { stream: part.file, wasTruncated: () => part.file.truncated, filename: part.filename, purpose: 'avatar' });
      await req.db.transaction(async (tx) => {
        await setAvatar(tx, req.auth.userId, row.id);
        await audit(tx, actorOf(req), { action: 'user.avatar_set', entity: 'user', entityId: req.auth.userId, after: { fileId: row.id } });
      });
      return { avatarUrl: toFileObject(row).url, file: toFileObject(row) };
    },
  );

  app.delete(
    '/me/avatar',
    { preHandler: [requireAuth], schema: { tags: ['Files', 'Auth'], summary: 'Remove my profile picture', response: { 200: avatarResponse } } },
    async (req) => {
      await req.db.transaction(async (tx) => {
        await setAvatar(tx, req.auth.userId, null);
        await audit(tx, actorOf(req), { action: 'user.avatar_removed', entity: 'user', entityId: req.auth.userId });
      });
      return { avatarUrl: null, file: null };
    },
  );
};

export default routes;
