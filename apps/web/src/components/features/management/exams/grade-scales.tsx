'use client';

import * as React from 'react';
import { Pencil, Plus, Star, Trash2 } from 'lucide-react';
import type { GradeScaleOut } from '@school-sync/shared';
import { PageHeader } from '@/components/shell/page-header';
import { Badge } from '@/components/ui/badge';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Drawer, DrawerContent, SheetBody, SheetFooter } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Field, Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { bff } from '@/lib/client/fetcher';
import { examErrorMessage, useExamMutation, useGradeScales } from '@/lib/client/exams-admin';
import { useUnsavedGuard } from '@/lib/client/use-unsaved-guard';
import { useAccess } from '../shared/access';
import { ErrorPanel } from '../shared/detail';
import { BandEditor, bandsPayload, bandsToRows, checkBands, newBandRow, type BandRow } from './band-editor';
import { ExamsAreaTabs } from './meta';

export function GradeScalesScreen() {
  const access = useAccess();
  const q = useGradeScales();
  const [editing, setEditing] = React.useState<GradeScaleOut | 'new' | null>(null);
  const [del, setDel] = React.useState<GradeScaleOut | null>(null);
  const [def, setDef] = React.useState<GradeScaleOut | null>(null);

  const remove = useExamMutation((s: GradeScaleOut) => bff(`/grade-scales/${s.id}`, { method: 'DELETE' }), { success: 'Grade scale deleted' });
  const makeDefault = useExamMutation((s: GradeScaleOut) => bff(`/grade-scales/${s.id}`, { method: 'PATCH', body: { isDefault: true } }), { success: (_r, s) => `${s.name} is now the default scale` });
  const defaultScale = q.data?.find((s) => s.isDefault);

  return (
    <>
      <PageHeader
        title="Grade scales"
        description="The percentage bands behind the letter grades on results and report cards."
        actions={
          access.can('exams:create') && (
            <Button onClick={() => setEditing('new')} disabled={!access.ok('exams:create')} title={access.hint('exams:create')}>
              <Plus /> New grade scale
            </Button>
          )
        }
      />
      <ExamsAreaTabs />
      {q.isPending ? (
        <div className="space-y-4">
          <Skeleton className="h-56 w-full" />
        </div>
      ) : q.isError ? (
        <ErrorPanel error={q.error} onRetry={() => void q.refetch()} title="We couldn’t load the grade scales" />
      ) : q.data.length === 0 ? (
        <Card>
          <EmptyState illustration="empty-generic" title="No grade scale yet" description="Create one so exams can turn percentages into letter grades." action={access.ok('exams:create') ? <Button onClick={() => setEditing('new')}><Plus /> New grade scale</Button> : undefined} compact />
        </Card>
      ) : (
        <div className="space-y-6">
          {q.data.map((s) => (
            <Card key={s.id}>
              <CardHeader
                title={
                  <span className="inline-flex flex-wrap items-center gap-2">
                    {s.name} {s.isDefault && <Badge variant="primary" icon={<Star aria-hidden />}>Default</Badge>}
                  </span>
                }
                description={`${s.bands.length} bands`}
                action={
                  <div className="flex flex-wrap justify-end gap-2">
                    {access.can('exams:edit') && !s.isDefault && (
                      <Button variant="secondary" size="sm" onClick={() => setDef(s)} disabled={!access.ok('exams:edit')} title={access.hint('exams:edit')}>
                        Make default
                      </Button>
                    )}
                    {access.can('exams:edit') && (
                      <Button variant="secondary" size="sm" onClick={() => setEditing(s)} disabled={!access.ok('exams:edit')} title={access.hint('exams:edit')}>
                        <Pencil /> Edit bands
                      </Button>
                    )}
                    {access.can('exams:delete') && !s.isDefault && (
                      <Button variant="danger" size="sm" onClick={() => setDel(s)} disabled={!access.ok('exams:delete')} title={access.hint('exams:delete')}>
                        <Trash2 /> Delete
                      </Button>
                    )}
                  </div>
                }
              />
              <CardBody className="pt-4">
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="t-table w-full">
                    <caption className="sr-only">Bands of {s.name}</caption>
                    <thead>
                      <tr>
                        {['Grade', 'Percentage', 'Points', 'Remark'].map((h, i) => (
                          <th key={h} scope="col" className={`t-colhead h-9 bg-surface-subtle px-3 text-ink-2 ${i === 2 ? 'text-right' : 'text-left'}`}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[...s.bands]
                        .sort((a, b) => b.minPercent - a.minPercent)
                        .map((b) => (
                          <tr key={b.id} className="border-t border-border">
                            <td className="h-10 px-3 font-medium">{b.label}</td>
                            <td className="tnum px-3">{b.minPercent}% – {b.maxPercent}%</td>
                            <td className="tnum px-3 text-right">{b.gradePoint ?? '—'}</td>
                            <td className="px-3 text-ink-2">{b.remark ?? '—'}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      <ScaleDrawer scale={editing} seed={defaultScale} onClose={() => setEditing(null)} />
      <ConfirmDialog
        open={def !== null}
        onOpenChange={(o) => !makeDefault.isPending && !o && setDef(null)}
        title={`Make ${def?.name ?? 'this scale'} the default?`}
        description="New exams that do not pick a scale will use it. Exams that already have a scale keep theirs."
        confirmLabel="Make default"
        loading={makeDefault.isPending}
        onConfirm={async () => {
          if (!def) return;
          const r = await makeDefault.run(def);
          if (r.ok) setDef(null);
        }}
      />
      <ConfirmDialog
        open={del !== null}
        onOpenChange={(o) => !remove.isPending && !o && setDel(null)}
        title={`Delete ${del?.name ?? 'grade scale'}?`}
        description="The scale and its bands are removed. A scale that an exam uses cannot be deleted; change the exam’s scale first. This cannot be undone."
        confirmLabel="Delete scale"
        destructive
        loading={remove.isPending}
        onConfirm={async () => {
          if (!del) return;
          const r = await remove.run(del);
          if (r.ok) setDel(null);
        }}
      />
    </>
  );
}

function ScaleDrawer({ scale, seed, onClose }: { scale: GradeScaleOut | 'new' | null; seed?: GradeScaleOut; onClose: () => void }) {
  const open = scale !== null;
  const existing = scale && scale !== 'new' ? scale : null;
  const [name, setName] = React.useState('');
  const [isDefault, setIsDefault] = React.useState(false);
  const [rows, setRows] = React.useState<BandRow[]>([]);
  const [touched, setTouched] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [initial, setInitial] = React.useState('');
  const snapshot = (n: string, d: boolean, r: BandRow[]) => JSON.stringify([n, d, r.map((x) => [x.label, x.min, x.max, x.point, x.remark])]);

  React.useEffect(() => {
    if (!open) return;
    const r = existing ? bandsToRows(existing.bands) : seed ? bandsToRows(seed.bands) : [newBandRow({ label: 'A', min: '50', max: '100' }), newBandRow({ label: 'F', min: '0', max: '49.99' })];
    const n = existing?.name ?? '';
    setName(n);
    setIsDefault(existing?.isDefault ?? false);
    setRows(r);
    setTouched(false);
    setError(null);
    setInitial(snapshot(n, existing?.isDefault ?? false, r));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, existing?.id]);

  const dirty = open && snapshot(name, isDefault, rows) !== initial;
  const { guard, dialog } = useUnsavedGuard(dirty);
  const check = checkBands(rows);
  const nameErr = touched && name.trim().length < 1 ? 'Give the scale a name.' : null;

  const save = useExamMutation(
    () => {
      const body = { name: name.trim(), isDefault, bands: bandsPayload(rows) };
      return existing ? bff<GradeScaleOut>(`/grade-scales/${existing.id}`, { method: 'PATCH', body }) : bff<GradeScaleOut>('/grade-scales', { method: 'POST', body });
    },
    { success: existing ? 'Grade scale saved' : 'Grade scale created', toastError: false },
  );
  const close = () => guard(onClose);

  return (
    <>
      <Drawer open={open} onOpenChange={(o) => !o && close()}>
        <DrawerContent
          title={existing ? `Edit ${existing.name}` : 'New grade scale'}
          description="Bands start at 0%, end at 100% and must not overlap."
          showTitle
          className="sm:w-[min(96vw,640px)]"
          onInteractOutside={(e) => {
            if (dirty) {
              e.preventDefault();
              close();
            }
          }}
        >
          <SheetBody>
            {existing && <Banner tone="warning">Letter grades on results and report cards come from these bands. Changing them changes the grade shown for every exam that uses this scale.</Banner>}
            {!existing && seed && <Banner tone="info">The bands start as a copy of “{seed.name}”. Adjust them to suit.</Banner>}
            <Field label="Name" htmlFor="scale-name" required error={nameErr}>
              <Input id="scale-name" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => setTouched(true)} maxLength={80} invalid={!!nameErr} placeholder="Standard (percentage)" autoFocus />
            </Field>
            <label className="flex items-start gap-2.5 text-sm">
              <Checkbox checked={isDefault} onCheckedChange={(v) => setIsDefault(v === true)} disabled={existing?.isDefault} className="mt-0.5" aria-label="Use as the default scale" />
              <span>
                Use as the default scale
                <span className="t-caption block text-ink-3">{existing?.isDefault ? 'This is the default. Make another scale the default to change it.' : 'New exams without a chosen scale use the default.'}</span>
              </span>
            </label>
            <BandEditor rows={rows} onChange={setRows} />
            {error && <Banner tone="danger">{error}</Banner>}
          </SheetBody>
          <SheetFooter>
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button
              loading={save.isPending}
              disabled={!check.valid && touched}
              onClick={async () => {
                setTouched(true);
                setError(null);
                if (!check.valid || name.trim().length < 1) return;
                try {
                  await save.mutateAsync();
                  setInitial(snapshot(name, isDefault, rows));
                  onClose();
                } catch (e) {
                  setError(examErrorMessage(e));
                }
              }}
            >
              {existing ? 'Save scale' : 'Create scale'}
            </Button>
          </SheetFooter>
        </DrawerContent>
      </Drawer>
      {dialog}
    </>
  );
}
