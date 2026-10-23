'use client';

import * as React from 'react';
import Link from 'next/link';
import { BadgeCheck, MoreHorizontal, ShieldAlert, UserPlus } from 'lucide-react';
import type { GuardianLinkOut, GuardianOut, StudentDetailOut } from '@school-sync/shared';
import { Badge } from '@/components/ui/badge';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/ui/empty-state';
import { IconButton } from '@/components/ui/icon-button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/components/ui/toaster';
import { useGuardianActions, useStudentActions } from '@/lib/client/people';
import { fmtDate } from '@/lib/format';
import { useAccess } from '../shared/access';
import { LabelledSelect } from '../shared/controls';
import { CredentialsDialog, type IssuedLogin } from '../shared/dialogs';
import { paths } from '../shared/paths';
import { ErrorBanner, peopleMessage } from './errors';
import { ChosenGuardian, GuardianPicker } from './fields';
import { FormDrawer } from './form-drawer';
import { GuardianCreateForm, LinkFlags } from './guardian-form';
import { RELATIONSHIP_OPTIONS, relationshipLabel } from './ui';

type Rel = GuardianLinkOut['relationship'];

function VerifiedChip({ verified }: { verified: boolean }) {
  return verified ? (
    <Badge variant="success" icon={<BadgeCheck aria-hidden />}>Verified</Badge>
  ) : (
    <Badge variant="warning" icon={<ShieldAlert aria-hidden />}>Awaiting verification</Badge>
  );
}

export function StudentGuardians({ student }: { student: StudentDetailOut }) {
  const acc = useAccess();
  const actions = useStudentActions(student.id);
  const canEdit = acc.ok('guardians:edit', 'school');
  const [linking, setLinking] = React.useState(false);
  const [editing, setEditing] = React.useState<GuardianLinkOut | null>(null);
  const [verifying, setVerifying] = React.useState<GuardianLinkOut | null>(null);
  const [unverifying, setUnverifying] = React.useState<GuardianLinkOut | null>(null);
  const [unlinking, setUnlinking] = React.useState<GuardianLinkOut | null>(null);
  const [creds, setCreds] = React.useState<IssuedLogin[] | null>(null);
  const [loginFor, setLoginFor] = React.useState<GuardianLinkOut | null>(null);

  const unverified = student.guardians.filter((g) => !g.verified);

  return (
    <div className="space-y-4">
      {unverified.length > 0 && (
        <Banner tone="warning" title={`${unverified.length} ${unverified.length === 1 ? 'parent is' : 'parents are'} waiting for verification`}>
          A parent only sees a child after the school verifies the relationship. Until then {unverified.length === 1 ? 'they cannot' : 'they cannot'} see {student.firstName}’s attendance, results or fees.
        </Banner>
      )}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3 max-sm:px-4">
          <h2 className="t-section">Parents and guardians</h2>
          {acc.can('guardians:edit', 'school') && (
            <Button size="sm" onClick={() => setLinking(true)} disabled={!canEdit} title={acc.hint('guardians:edit', 'school')}>
              <UserPlus /> Link a parent
            </Button>
          )}
        </div>
        {student.guardians.length === 0 ? (
          <EmptyState illustration="empty-generic" compact title="No parents linked yet" description="Link a registered parent, or add a new one. Parents see the child only after you verify the link." />
        ) : (
          <ul className="divide-y divide-border">
            {student.guardians.map((g) => (
              <li key={g.guardianId} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-5 py-4 max-sm:px-4">
                <div className="min-w-0 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    {acc.can('guardians:view') ? (
                      <Link href={paths.guardian(g.guardianId)} className="rounded-sm text-sm font-medium hover:underline">{g.name}</Link>
                    ) : (
                      <span className="text-sm font-medium">{g.name}</span>
                    )}
                    <span className="t-caption text-ink-2">{relationshipLabel(g.relationship)}</span>
                    <VerifiedChip verified={g.verified} />
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {g.isPrimary && <Badge variant="primary">Primary contact</Badge>}
                    {g.canPickup && <Badge variant="neutral">Pickup</Badge>}
                    {g.isEmergencyContact && <Badge variant="neutral">Emergency contact</Badge>}
                    {g.hasLogin ? <Badge variant="neutral">Has login</Badge> : <Badge variant="outline">No login</Badge>}
                  </div>
                  <p className="t-caption text-ink-2">
                    {g.phone || g.email ? [g.phone, g.email].filter(Boolean).join(' · ') : 'Contact details are hidden for your role'}
                    {g.verifiedAt && <> · verified {fmtDate(g.verifiedAt)}</>}
                  </p>
                </div>
                {canEdit && (
                  <div className="flex items-center gap-2">
                    {!g.verified && (
                      <Button size="sm" variant="secondary" onClick={() => setVerifying(g)}>
                        Verify
                      </Button>
                    )}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <IconButton label={`Actions for ${g.name}`} variant="ghost" size="icon-sm">
                          <MoreHorizontal />
                        </IconButton>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        <DropdownMenuItem onSelect={() => setEditing(g)}>Edit relationship and flags</DropdownMenuItem>
                        {g.verified && <DropdownMenuItem onSelect={() => setUnverifying(g)}>Withdraw verification</DropdownMenuItem>}
                        {!g.hasLogin && <DropdownMenuItem onSelect={() => setLoginFor(g)}>Create parent login</DropdownMenuItem>}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem danger onSelect={() => setUnlinking(g)}>Unlink from {student.firstName}</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <LinkDrawer
        open={linking}
        onOpenChange={setLinking}
        student={student}
        onCredentials={(l) => setCreds(l)}
      />
      <EditLinkDialog link={editing} student={student} onClose={() => setEditing(null)} />

      <ConfirmDialog
        open={!!verifying}
        onOpenChange={(o) => !o && setVerifying(null)}
        title={`Verify ${verifying?.name ?? 'this parent'}?`}
        description={`Confirm that ${verifying?.name ?? 'this person'} is ${student.name}’s ${verifying ? relationshipLabel(verifying.relationship).toLowerCase() : 'parent'}. From now on they can see this child’s attendance, results and fees, and they are notified.`}
        confirmLabel="Verify link"
        loading={actions.verify.isPending}
        onConfirm={async () => {
          if (!verifying) return;
          const r = await actions.verify.run(verifying.guardianId);
          if (r.ok) setVerifying(null);
        }}
      />
      <ConfirmDialog
        open={!!unverifying}
        onOpenChange={(o) => !o && setUnverifying(null)}
        title={`Withdraw verification for ${unverifying?.name ?? ''}?`}
        description={`${unverifying?.name ?? 'The parent'} immediately loses access to ${student.name}. The link stays, so you can verify it again later.`}
        confirmLabel="Withdraw verification"
        destructive
        loading={actions.unverify.isPending}
        onConfirm={async () => {
          if (!unverifying) return;
          const r = await actions.unverify.run(unverifying.guardianId);
          if (r.ok) setUnverifying(null);
        }}
      />
      <ConfirmDialog
        open={!!unlinking}
        onOpenChange={(o) => !o && setUnlinking(null)}
        title={`Unlink ${unlinking?.name ?? 'this parent'} from ${student.firstName}?`}
        description={`${unlinking?.name ?? 'The parent'} loses access to ${student.name} and is removed as a contact for this student. Their own account and any other children they have are not affected.`}
        confirmLabel="Unlink parent"
        destructive
        loading={actions.unlink.isPending}
        onConfirm={async () => {
          if (!unlinking) return;
          const r = await actions.unlink.run(unlinking.guardianId);
          if (r.ok) setUnlinking(null);
        }}
      />
      <CreateLoginConfirm link={loginFor} onClose={() => setLoginFor(null)} onCreated={(l) => setCreds(l)} />
      <CredentialsDialog open={!!creds} onOpenChange={(o) => !o && setCreds(null)} logins={creds ?? []} title="Parent sign-in details" />
    </div>
  );
}

function CreateLoginConfirm({ link, onClose, onCreated }: { link: GuardianLinkOut | null; onClose: () => void; onCreated: (l: IssuedLogin[]) => void }) {
  const { createLogin } = useGuardianActions(link?.guardianId ?? '');
  const [error, setError] = React.useState<unknown>(null);
  React.useEffect(() => setError(null), [link]);
  return (
    <Dialog open={!!link} onOpenChange={(o) => !o && !createLogin.isPending && onClose()}>
      <DialogContent title={`Create a login for ${link?.name ?? 'this parent'}?`} description="The username is their mobile number (or email). A temporary password is shown once; they must change it when they first sign in.">
        <div className="mt-4 space-y-4">
          {!link?.phone && !link?.email && link && <Banner tone="info">Their contact details are hidden for your role. The API needs a phone number or email on the parent’s record; if it has none you will be asked to add one first.</Banner>}
          <ErrorBanner error={error} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose} disabled={createLogin.isPending}>Cancel</Button>
            <Button
              loading={createLogin.isPending}
              onClick={async () => {
                setError(null);
                try {
                  const c = await createLogin.mutateAsync();
                  onCreated([{ label: `Parent (${link?.name})`, username: c.username, temporaryPassword: c.temporaryPassword }]);
                  onClose();
                } catch (e) {
                  setError(e);
                }
              }}
            >
              Create login
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EditLinkDialog({ link, student, onClose }: { link: GuardianLinkOut | null; student: StudentDetailOut; onClose: () => void }) {
  const { updateLink } = useStudentActions(student.id);
  const [rel, setRel] = React.useState<Rel>('guardian');
  const [flags, setFlags] = React.useState({ isPrimary: false, canPickup: false, isEmergencyContact: false });
  const [error, setError] = React.useState<unknown>(null);
  React.useEffect(() => {
    if (link) {
      setRel(link.relationship);
      setFlags({ isPrimary: link.isPrimary, canPickup: link.canPickup, isEmergencyContact: link.isEmergencyContact });
      setError(null);
    }
  }, [link]);
  return (
    <Dialog open={!!link} onOpenChange={(o) => !o && !updateLink.isPending && onClose()}>
      <DialogContent title={`${link?.name ?? 'Parent'} and ${student.firstName}`} description="How this parent relates to the student, and what they may do.">
        <form
          className="mt-4 space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!link) return;
            setError(null);
            try {
              await updateLink.mutateAsync({ guardianId: link.guardianId, body: { relationship: rel, ...flags } });
              onClose();
            } catch (err) {
              setError(err);
            }
          }}
        >
          <LabelledSelect label="Relationship" value={rel} onChange={(v) => setRel(v as Rel)} options={RELATIONSHIP_OPTIONS} />
          <LinkFlags value={flags} onChange={setFlags} showVerified={false} />
          <ErrorBanner error={error} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose} disabled={updateLink.isPending}>Cancel</Button>
            <Button type="submit" loading={updateLink.isPending}>Save</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Link an existing parent, or register a new one and link them in one go. */
function LinkDrawer({ open, onOpenChange, student, onCredentials }: { open: boolean; onOpenChange: (o: boolean) => void; student: StudentDetailOut; onCredentials: (l: IssuedLogin[]) => void }) {
  const [mode, setMode] = React.useState<'existing' | 'new'>('existing');
  const { link: linkMutation } = useStudentActions(student.id);
  const linked = student.guardians.map((g) => g.guardianId);
  return (
    <FormDrawer open={open} onOpenChange={onOpenChange} title="Link a parent" description={`Connect a parent or guardian to ${student.name}.`}>
      <div className="px-5 pt-2">
        <Tabs value={mode} onValueChange={(v) => setMode(v as 'existing' | 'new')}>
          <TabsList aria-label="Parent source">
            <TabsTrigger value="existing">Registered parent</TabsTrigger>
            <TabsTrigger value="new">New parent</TabsTrigger>
          </TabsList>
          <TabsContent value="existing" className="mt-4">
            <ExistingParent student={student} exclude={linked} onDone={() => onOpenChange(false)} />
          </TabsContent>
          <TabsContent value="new" className="mt-0 -mx-5">
            <GuardianCreateForm
              withLink
              submitLabel="Add and link parent"
              onCreated={async (g: GuardianOut, credential, link) => {
                const logins: IssuedLogin[] = credential ? [{ label: `Parent (${g.name})`, username: credential.username, temporaryPassword: credential.temporaryPassword }] : [];
                try {
                  await linkMutation.mutateAsync({ guardianId: g.id, relationship: link?.relationship ?? 'guardian', isPrimary: link?.isPrimary, canPickup: link?.canPickup, isEmergencyContact: link?.isEmergencyContact, verified: link?.verified ?? false });
                } catch (e) {
                  toast.error(`${g.name} was registered but could not be linked: ${peopleMessage(e)}. Link them from “Registered parent”.`, { duration: 10000 });
                }
                onOpenChange(false);
                if (logins.length) onCredentials(logins);
              }}
            />
          </TabsContent>
        </Tabs>
      </div>
    </FormDrawer>
  );
}

function ExistingParent({ student, exclude, onDone }: { student: StudentDetailOut; exclude: string[]; onDone: () => void }) {
  const { link } = useStudentActions(student.id);
  const [chosen, setChosen] = React.useState<GuardianOut | null>(null);
  const [rel, setRel] = React.useState<Rel>('guardian');
  const [flags, setFlags] = React.useState({ isPrimary: false, canPickup: true, isEmergencyContact: false, verified: false });
  const [error, setError] = React.useState<unknown>(null);
  return (
    <form
      className="space-y-5 pb-5"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!chosen) return;
        setError(null);
        try {
          await link.mutateAsync({ guardianId: chosen.id, relationship: rel, ...flags });
          onDone();
        } catch (err) {
          setError(err);
        }
      }}
    >
      {chosen ? <ChosenGuardian g={chosen} onClear={() => setChosen(null)} /> : <GuardianPicker exclude={exclude} onPick={setChosen} />}
      {chosen && (
        <>
          <LabelledSelect label="Relationship to the student" value={rel} onChange={(v) => setRel(v as Rel)} options={RELATIONSHIP_OPTIONS} />
          <LinkFlags value={flags} onChange={setFlags} />
        </>
      )}
      <ErrorBanner error={error} />
      <div className="flex justify-end gap-2">
        <Button type="submit" disabled={!chosen} loading={link.isPending}>
          Link parent
        </Button>
      </div>
    </form>
  );
}
