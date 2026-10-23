'use client';

import * as React from 'react';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, Drawer, DrawerContent, SheetBody, SheetFooter } from '@/components/ui/dialog';
import { useUnsavedGuard } from '@/lib/client/use-unsaved-guard';

/**
 * Mount this only while the dialog is open (`{editing && <MyDialog …/>}`) so the form starts fresh each time.
 * Closing with unsaved edits asks first (Esc, the X, a click outside, or following a link).
 */
export function ModalForm({ title, description, size = 'md', dirty, onClose, children }: { title: string; description?: string; size?: 'md' | 'lg'; dirty: boolean; onClose: () => void; children: React.ReactNode }) {
  const { guard, dialog } = useUnsavedGuard(dirty);
  return (
    <>
      <Dialog open onOpenChange={(o) => !o && guard(onClose)}>
        <DialogContent title={title} description={description} size={size}>
          {children}
        </DialogContent>
      </Dialog>
      {dialog}
    </>
  );
}

/** Right-hand drawer variant (long forms and detail). */
export function DrawerForm({ title, description, dirty, onClose, children, footer }: { title: string; description?: string; dirty: boolean; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode }) {
  const { guard, dialog } = useUnsavedGuard(dirty);
  return (
    <>
      <Drawer open onOpenChange={(o) => !o && guard(onClose)}>
        <DrawerContent title={title} description={description} showTitle>
          <SheetBody>{children}</SheetBody>
          {footer && <SheetFooter>{footer}</SheetFooter>}
        </DrawerContent>
      </Drawer>
      {dialog}
    </>
  );
}

export function FormBanner({ message }: { message: string | null | undefined }) {
  return message ? (
    <Banner tone="danger" role="alert">
      {message}
    </Banner>
  ) : null;
}

/** Cancel + submit row at the bottom of a dialog form. */
export function DialogButtons({ onCancel, submitLabel, loading, disabled, disabledHint }: { onCancel: () => void; submitLabel: string; loading?: boolean; disabled?: boolean; disabledHint?: string }) {
  return (
    <div className="flex justify-end gap-2 pt-1">
      <Button type="button" variant="secondary" onClick={onCancel} disabled={loading}>
        Cancel
      </Button>
      <Button type="submit" loading={loading} disabled={disabled} title={disabled ? disabledHint : undefined}>
        {submitLabel}
      </Button>
    </div>
  );
}
