'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { Laptop, Smartphone } from 'lucide-react';
import { bff } from '@/lib/client/fetcher';
import { qk, useSessions, type SessionInfo } from '@/lib/client/queries';
import { errorMessage } from '@/lib/problem';
import { EXPERIENCES } from '@/lib/experience';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardBody } from '../ui/card';
import { EmptyState } from '../ui/empty-state';
import { Skeleton } from '../ui/skeleton';
import { toast } from '../ui/toaster';
import { PageHeader } from '../shell/page-header';
import { useMe } from '../me-context';

export function SessionsPage() {
  const me = useMe();
  const qc = useQueryClient();
  const q = useSessions();
  const revoke = useMutation({
    mutationFn: (id: string) => bff(`/auth/sessions/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Device signed out');
      void qc.invalidateQueries({ queryKey: qk.sessions });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const revokeOthers = useMutation({
    mutationFn: () => bff('/auth/sessions/revoke-others', { method: 'POST', body: {} }),
    onSuccess: () => {
      toast.success('Signed out everywhere else');
      void qc.invalidateQueries({ queryKey: qk.sessions });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const others = (q.data ?? []).filter((s) => !s.current).length;

  return (
    <>
      <PageHeader
        title="Sessions and devices"
        description="Everywhere your account is signed in. If you don’t recognise one, sign it out and change your password."
        crumbs={[{ label: 'Home', href: EXPERIENCES[me.experience].base }, { label: 'My profile', href: '/account' }, { label: 'Sessions' }]}
        actions={others > 0 && <Button variant="secondary" loading={revokeOthers.isPending} onClick={() => revokeOthers.mutate()}>Sign out all other devices</Button>}
      />
      <Card className="overflow-hidden">
        {q.isPending ? (
          <CardBody className="space-y-4">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </CardBody>
        ) : q.isError ? (
          <EmptyState title="We could not load your sessions" description={errorMessage(q.error)} action={<Button variant="secondary" onClick={() => void q.refetch()}>Try again</Button>} />
        ) : q.data.length === 0 ? (
          <EmptyState title="No active sessions" />
        ) : (
          <ul className="divide-y divide-border">
            {q.data.map((s) => (
              <SessionRow key={s.id} s={s} busy={revoke.isPending && revoke.variables === s.id} onRevoke={() => revoke.mutate(s.id)} />
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

function SessionRow({ s, busy, onRevoke }: { s: SessionInfo; busy: boolean; onRevoke: () => void }) {
  const Icon = s.platform === 'web' ? Laptop : Smartphone;
  return (
    <li className="flex min-h-14 items-center gap-4 px-5 py-2.5">
      <Icon className="size-5 shrink-0 text-subtle" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
          {s.deviceName ?? (s.platform === 'web' ? 'Web browser' : `${s.platform} app`)}
          {s.current && <Badge variant="success">This device</Badge>}
        </p>
        <p className="text-[13px] text-muted-foreground">
          {s.platform === 'web' ? 'Web' : s.platform === 'ios' ? 'iOS app' : 'Android app'}
          {s.ip ? ` · ${s.ip}` : ''} · active {formatDistanceToNow(new Date(s.lastUsedAt), { addSuffix: true })}
        </p>
      </div>
      {!s.current && (
        <Button variant="ghost" size="sm" loading={busy} onClick={onRevoke}>
          Sign out
        </Button>
      )}
    </li>
  );
}
