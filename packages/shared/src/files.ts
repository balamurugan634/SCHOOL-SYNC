import { z } from 'zod';
import { isoDateTime, uuid } from './common';

/** Why a file is uploaded. Drives the allowed content types, the size cap and who may upload / read it. */
export const FILE_PURPOSES = ['avatar', 'homework', 'submission', 'material', 'document', 'receipt', 'announcement', 'other'] as const;
export type FilePurpose = (typeof FILE_PURPOSES)[number];
export const filePurpose = z.enum(FILE_PURPOSES);

/**
 * Shape clients drop straight into an `attachments` array (homework, submissions, announcements …).
 * `url` is a *relative* API path (`/api/v1/files/<id>`) that needs the bearer token to be fetched.
 */
export const fileAttachmentRef = z.object({
  fileId: uuid,
  name: z.string(),
  mimeType: z.string().optional(),
  sizeBytes: z.number().int().optional(),
});
export type FileAttachmentRef = z.infer<typeof fileAttachmentRef>;

export const fileAttachment = fileAttachmentRef.extend({ url: z.string() });
export type FileAttachment = z.infer<typeof fileAttachment>;

export const fileObject = z.object({
  id: uuid,
  url: z.string(),
  name: z.string(),
  /** the *detected* type (from the file's bytes), not what the client claimed */
  mimeType: z.string(),
  sizeBytes: z.number().int(),
  sha256: z.string().nullable(),
  purpose: filePurpose,
  uploadedBy: uuid.nullable(),
  createdAt: isoDateTime,
});
export type FileObject = z.infer<typeof fileObject>;

export const fileUploadResponse = fileObject.extend({ attachment: fileAttachmentRef });
export type FileUploadResponse = z.infer<typeof fileUploadResponse>;

/** Query of `POST /files` — `purpose` may also be sent as a multipart field, but then it must come *before* the `file` part. */
export const fileUploadQuery = z.object({ purpose: filePurpose.optional() });

/** Documentation-only: the multipart body of `POST /files` and `PUT /me/avatar` (never validated as JSON). */
export const fileUploadForm = z
  .object({
    purpose: filePurpose.optional().describe('send BEFORE `file`, or use the ?purpose= query parameter'),
    file: z.any().meta({ type: 'string', format: 'binary', description: 'the file bytes' }),
  });

export const fileDownloadQuery = z.object({
  /** force `Content-Disposition: attachment` */
  download: z.enum(['1', 'true']).optional(),
});

export const avatarResponse = z.object({ avatarUrl: z.string().nullable(), file: fileObject.nullable() });
export type AvatarResponse = z.infer<typeof avatarResponse>;
