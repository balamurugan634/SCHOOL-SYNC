'use client';

import * as React from 'react';
import type { Me, PermissionKey, Scope } from '@school-sync/shared';
import { can as canFn, canAny as canAnyFn } from '@/lib/permissions';

interface MeCtx {
  me: Me;
  /** true on the dev-only preview route: the user is synthetic */
  preview: boolean;
  /** href prefix of the current experience (`/admin`, or `/dev/preview/student` in the preview) */
  base: string;
  /** parent only: currently selected child */
  childId: string | null;
  setChildId: (id: string) => void;
}

const Ctx = React.createContext<MeCtx | null>(null);

const CHILD_KEY = (userId: string) => `ss:child:${userId}`;

export function MeProvider({ me, preview = false, base, children }: { me: Me; preview?: boolean; base: string; children: React.ReactNode }) {
  const firstChild = me.profile.children[0]?.studentId ?? null;
  const [childId, setChild] = React.useState<string | null>(firstChild);

  React.useEffect(() => {
    try {
      const saved = localStorage.getItem(CHILD_KEY(me.id));
      if (saved && me.profile.children.some((c) => c.studentId === saved)) setChild(saved);
    } catch {}
  }, [me.id, me.profile.children]);

  const setChildId = React.useCallback(
    (id: string) => {
      setChild(id);
      try {
        localStorage.setItem(CHILD_KEY(me.id), id);
      } catch {}
    },
    [me.id],
  );

  const value = React.useMemo(() => ({ me, preview, base, childId, setChildId }), [me, preview, base, childId, setChildId]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useMeContext(): MeCtx {
  const v = React.useContext(Ctx);
  if (!v) throw new Error('useMe must be used inside <MeProvider>');
  return v;
}
export const useMe = (): Me => useMeContext().me;

/** UI gating helper: `const { can } = usePermissions(); can('fees:view')`. The API enforces for real. */
export function usePermissions() {
  const { me } = useMeContext();
  return React.useMemo(
    () => ({
      can: (p: PermissionKey, min?: Scope) => canFn(me.permissions, p, min),
      canAny: (...p: PermissionKey[]) => canAnyFn(me.permissions, ...p),
    }),
    [me.permissions],
  );
}
