'use client';

import * as React from 'react';
import { ExternalLink, FileText, MoreHorizontal, Upload } from 'lucide-react';
import { STUDENT_DOCUMENT_KINDS, type StudentDetailOut, type StudentDocumentOut } from '@school-sync/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/ui/empty-state';
import { IconButton } from '@/components/ui/icon-button';
import { Field, Input } from '@/components/ui/input';
import { assetUrl } from '@/lib/assets';
import { bff } from '@/lib/client/fetcher';
import { useStudentActions } from '@/lib/client/people';
import { MAX_UPLOAD_MB, uploadFile } from '@/lib/client/transfer';
import { fmtDate } from '@/lib/format';
import { useAccess } from '../shared/access';
import { LabelledSelect } from '../shared/controls';
import { ErrorBanner } from './errors';
import { Restricted } from './fields';
import { titleCase } from './ui';

const KIND_OPTIONS = STUDENT_DOCUMENT_KINDS.map((k) => ({ value: k, label: titleCase(k) }));
const ACCEPT = 'application/pdf,image/jpeg,image/png,image/webp';

export function StudentDocuments({ student }: { student: StudentDetailOut }) {
  const acc = useAccess();
  const actions = useStudentActions(student.id);
  const [uploading, setUploading] = React.useState(false);
  const [removing, setRemoving] = React.useState<StudentDocumentOut | null>(null);
  const docs = student.documents;

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3 max-sm:px-4">
        <div>
          <h2 className="t-section">Documents</h2>
          <p className="t-caption text-ink-2">Certificates, ID proofs and medical records. Parents cannot see these.</p>
        </div>
        {docs && acc.can('student_documents:create') && (
          <Button size="sm" onClick={() => setUploading(true)} disabled={!acc.ok('student_documents:create')} title={acc.hint('student_documents:create')}>
            <Upload /> Add document
          </Button>
        )}
      </div>
      {docs === null ? (
        <div className="px-5 py-8 text-center max-sm:px-4"><Restricted what="Student documents" /></div>
      ) : docs.length === 0 ? (
        <EmptyState illustration="empty-generic" compact title="No documents yet" description="Upload a birth certificate, transfer certificate or ID proof. Mark each one as checked once the school has seen the original." />
      ) : (
        <ul className="divide-y divide-border">
          {docs.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-3.5 max-sm:px-4">
              <div className="flex min-w-0 items-center gap-3">
                <FileText className="size-5 shrink-0 text-ink-3" aria-hidden />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{d.title || titleCase(d.kind)}</p>
                  <p className="t-caption text-ink-2">{titleCase(d.kind)} · added {fmtDate(d.createdAt)}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {d.verified ? <Badge variant="success">Checked{d.verifiedAt ? ` ${fmtDate(d.verifiedAt)}` : ''}</Badge> : <Badge variant="warning">Not checked yet</Badge>}
                <Button asChild variant="secondary" size="sm">
                  <a href={assetUrl(d.fileUrl) ?? '#'} target="_blank" rel="noopener noreferrer">
                    View <ExternalLink />
                  </a>
                </Button>
                {(acc.can('student_documents:create') || acc.can('student_documents:delete')) && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <IconButton label={`Actions for ${d.title || titleCase(d.kind)}`} variant="ghost" size="icon-sm">
                        <MoreHorizontal />
                      </IconButton>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      {!d.verified && acc.can('student_documents:create') && (
                        <DropdownMenuItem disabled={!acc.ok('student_documents:create')} onSelect={() => void actions.verifyDocument.run(d.id)}>
                          Mark as checked
                        </DropdownMenuItem>
                      )}
                      {acc.can('student_documents:delete') && (
                        <>
                          {!d.verified && acc.can('student_documents:create') && <DropdownMenuSeparator />}
                          <DropdownMenuItem danger disabled={!acc.ok('student_documents:delete')} onSelect={() => setRemoving(d)}>
                            Remove document
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <UploadDialog open={uploading} onClose={() => setUploading(false)} student={student} />
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`Remove “${removing?.title || (removing ? titleCase(removing.kind) : '')}”?`}
        description={`The document is removed from ${student.name}’s record and can no longer be opened. The removal is recorded in the audit log.`}
        confirmLabel="Remove document"
        destructive
        loading={actions.deleteDocument.isPending}
        onConfirm={async () => {
          if (!removing) return;
          const r = await actions.deleteDocument.run(removing.id);
          if (r.ok) setRemoving(null);
        }}
      />
    </Card>
  );
}

function UploadDialog({ open, onClose, student }: { open: boolean; onClose: () => void; student: StudentDetailOut }) {
  const { addDocument } = useStudentActions(student.id);
  const [kind, setKind] = React.useState<string>('birth_certificate');
  const [title, setTitle] = React.useState('');
  const [file, setFile] = React.useState<File | null>(null);
  const [fileError, setFileError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<unknown>(null);
  React.useEffect(() => {
    if (open) {
      setKind('birth_certificate');
      setTitle('');
      setFile(null);
      setFileError(null);
      setError(null);
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent title="Add a document" description={`Attach a file to ${student.name}’s record. PDF, JPG, PNG or WebP, up to ${MAX_UPLOAD_MB} MB.`}>
        <form
          className="mt-4 space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!file) {
              setFileError('Choose a file to upload.');
              return;
            }
            setBusy(true);
            setError(null);
            let uploadedId: string | null = null;
            try {
              const up = await uploadFile(file, 'document');
              uploadedId = up.id;
              await addDocument.mutateAsync({ kind: kind as (typeof STUDENT_DOCUMENT_KINDS)[number], title: title.trim() || undefined, fileId: up.id });
              onClose();
            } catch (err) {
              setError(err);
              // the file was stored but could not be attached: don't leave it orphaned
              if (uploadedId) void bff(`/files/${uploadedId}`, { method: 'DELETE' }).catch(() => undefined);
            } finally {
              setBusy(false);
            }
          }}
        >
          <LabelledSelect label="Type" value={kind} onChange={setKind} options={KIND_OPTIONS} required />
          <Field label="Title" htmlFor="doc-title" hint="Optional, for example “Birth certificate (original)”.">
            <Input id="doc-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} autoComplete="off" />
          </Field>
          <Field label="File" htmlFor="doc-file" required error={fileError}>
            <input
              id="doc-file"
              type="file"
              accept={ACCEPT}
              aria-invalid={!!fileError || undefined}
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                if (f && f.size > MAX_UPLOAD_MB * 1024 * 1024) {
                  setFile(null);
                  setFileError(`That file is ${(f.size / 1048576).toFixed(1)} MB. The limit is ${MAX_UPLOAD_MB} MB.`);
                } else {
                  setFile(f);
                  setFileError(null);
                }
              }}
              className="block w-full rounded-md border border-border-strong bg-surface p-1.5 text-sm file:mr-3 file:h-8 file:cursor-pointer file:rounded-md file:border-0 file:bg-surface-sunken file:px-3 file:text-[13px] file:font-medium file:text-ink hover:file:bg-border"
            />
          </Field>
          <ErrorBanner error={error} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" loading={busy}>
              Upload and attach
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
