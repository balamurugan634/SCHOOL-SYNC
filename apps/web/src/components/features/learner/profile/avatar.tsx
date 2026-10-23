'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Camera, Trash2 } from 'lucide-react';
import { useRemoveAvatar, useUploadAvatar } from '@/lib/client/learner-profile';
import { AVATAR_ACCEPT, checkUpload, MAX_AVATAR_BYTES } from '@/lib/client/learner-files';
import { assetUrl } from '@/lib/assets';
import { errorMessage } from '@/lib/problem';
import { Avatar } from '@/components/ui/avatar';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ProgressBar } from '@/components/ui/progress';
import { toast } from '@/components/ui/toaster';
import { useMe, useMeContext } from '@/components/me-context';
import { useGates } from '../use-learner';

/** Profile picture: JPEG / PNG / WebP up to 5 MB, with upload progress. The shell re-reads the user afterwards (router.refresh). */
export function AvatarCard() {
  const me = useMe();
  const { preview } = useMeContext();
  const { readOnly } = useGates();
  const router = useRouter();
  const upload = useUploadAvatar();
  const remove = useRemoveAvatar();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [pct, setPct] = React.useState<number | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [confirm, setConfirm] = React.useState(false);

  const pick = async (file: File) => {
    setError(null);
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
      setError('Please choose a JPEG, PNG or WebP picture.');
      return;
    }
    const problem = checkUpload(file, MAX_AVATAR_BYTES);
    if (problem) {
      setError(problem);
      return;
    }
    setPct(0);
    try {
      await upload.mutateAsync({ file, onProgress: setPct });
      toast.success('Profile picture updated');
      router.refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPct(null);
    }
  };

  const doRemove = async () => {
    try {
      await remove.mutateAsync();
      toast.success('Profile picture removed');
      router.refresh();
    } catch (e) {
      toast.error(errorMessage(e), { duration: 8000 });
    } finally {
      setConfirm(false);
    }
  };

  const uploading = pct !== null;
  return (
    <Card>
      <CardBody className="flex flex-wrap items-center gap-4">
        <Avatar name={me.displayName} src={assetUrl(me.avatarUrl)} size="xl" ring role={me.experience} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold">{me.displayName}</p>
          <p className="t-caption text-ink-2">{me.username}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <input
              ref={inputRef}
              type="file"
              accept={AVATAR_ACCEPT}
              className="sr-only"
              aria-label="Choose a profile picture"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) void pick(f);
              }}
            />
            <Button variant="secondary" size="sm" disabled={readOnly || uploading || preview} onClick={() => inputRef.current?.click()}>
              <Camera /> {me.avatarUrl ? 'Change photo' : 'Add a photo'}
            </Button>
            {me.avatarUrl && (
              <Button variant="ghost" size="sm" disabled={readOnly || uploading || preview} onClick={() => setConfirm(true)}>
                <Trash2 /> Remove
              </Button>
            )}
          </div>
          {uploading && (
            <div className="mt-3 max-w-xs space-y-1" role="status" aria-live="polite">
              <ProgressBar value={pct ?? 0} label="Uploading picture" />
              <p className="t-caption text-ink-2">Uploading… {pct}%</p>
            </div>
          )}
          {!uploading && <p className="t-caption mt-2 text-ink-3">JPEG, PNG or WebP, up to 5 MB.</p>}
        </div>
      </CardBody>
      {error && (
        <div className="px-5 pb-5 max-sm:px-4 max-sm:pb-4">
          <Banner tone="danger">{error}</Banner>
        </div>
      )}
      <ConfirmDialog open={confirm} onOpenChange={setConfirm} title="Remove your profile picture?" description="Your initials will be shown instead. You can add a picture again at any time." confirmLabel="Remove picture" destructive loading={remove.isPending} onConfirm={() => void doRemove()} />
    </Card>
  );
}
