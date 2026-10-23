'use client';

import * as React from 'react';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Drawer, DrawerContent } from '@/components/ui/dialog';

interface Ctx {
  setDirty: (d: boolean) => void;
  requestClose: () => void;
}
const DrawerCtx = React.createContext<Ctx | null>(null);

/**
 * Right-hand drawer for a form with the unsaved-changes guard wired to every way of closing it (Esc, outside click,
 * the close button, the form's own Cancel). The form inside calls `useFormDrawer(isDirty)`.
 */
export function FormDrawer({ open, onOpenChange, title, description, children }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; description?: string; children: React.ReactNode }) {
  const [dirty, setDirty] = React.useState(false);
  const [confirm, setConfirm] = React.useState(false);
  const requestClose = React.useCallback(() => (dirty ? setConfirm(true) : onOpenChange(false)), [dirty, onOpenChange]);
  const value = React.useMemo(() => ({ setDirty, requestClose }), [requestClose]);
  return (
    <>
      <Drawer open={open} onOpenChange={(o) => (o ? onOpenChange(true) : requestClose())}>
        <DrawerContent
          title={title}
          description={description}
          showTitle
          onInteractOutside={(e) => {
            if (dirty) {
              e.preventDefault();
              setConfirm(true);
            }
          }}
        >
          <DrawerCtx.Provider value={value}>{children}</DrawerCtx.Provider>
        </DrawerContent>
      </Drawer>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Close without saving?"
        description="You have changes that have not been saved. If you close now they will be lost."
        confirmLabel="Discard changes"
        cancelLabel="Keep editing"
        destructive
        onConfirm={() => {
          setConfirm(false);
          setDirty(false);
          onOpenChange(false);
        }}
      />
    </>
  );
}

/** Inside a `FormDrawer`: report whether the form is dirty, and get the guarded close (use it for Cancel). */
export function useFormDrawer(dirty: boolean) {
  const c = React.useContext(DrawerCtx);
  React.useEffect(() => {
    c?.setDirty(dirty);
    return () => c?.setDirty(false);
  }, [c, dirty]);
  return { requestClose: c?.requestClose ?? (() => undefined) };
}
