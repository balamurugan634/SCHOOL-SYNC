'use client';

import * as React from 'react';
import Link from 'next/link';
import { KeyRound, ShieldCheck } from 'lucide-react';
import { useMyProfile, useStudentRecord } from '@/lib/client/learner-profile';
import { fmtDate } from '@/lib/format';
import { PageHeader } from '@/components/shell/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useMe } from '@/components/me-context';
import { MoreNav } from '../more-nav';
import { FeatureGate } from '../gate';
import { ChildContext, ErrorState, NeedsLearner, QueryView } from '../states';
import { useLearner } from '../use-learner';
import { AvatarCard } from './avatar';
import { ContactDetailsForm, EmergencyContactsForm } from './contact-forms';
import { CorrectionsPanel } from './corrections';

const GENDER: Record<string, string> = { male: 'Male', female: 'Female', other: 'Other' };

function SecurityCard() {
  return (
    <Card>
      <CardHeader title="Security" />
      <CardBody className="flex flex-col gap-2 pt-3">
        <Button asChild variant="secondary" className="justify-start"><Link href="/change-password"><KeyRound /> Change password</Link></Button>
        <Button asChild variant="secondary" className="justify-start"><Link href="/account/sessions"><ShieldCheck /> Sessions and devices</Link></Button>
      </CardBody>
    </Card>
  );
}

/** The official record, read only. Changes go through a correction request. */
function RecordCard({ studentId }: { studentId: string }) {
  const q = useStudentRecord(studentId);
  const l = useLearner();
  return (
    <Card>
      <CardHeader title={l.isParent ? `${l.name}’s record` : 'Your school record'} description="Kept by the school office. To change anything here, request a correction below." />
      <CardBody className="pt-3">
        <QueryView
          query={q}
          skeleton={<div className="space-y-3" aria-busy="true"><Skeleton className="h-5 w-2/3" /><Skeleton className="h-5 w-1/2" /><Skeleton className="h-5 w-3/5" /></div>}
        >
          {(r) => (
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              {(
                [
                  ['Name', r.name],
                  ['Admission no.', r.admissionNo],
                  ['Class', [r.gradeName, r.sectionName].filter(Boolean).join(' · ') || '—'],
                  ['Roll no.', r.rollNo === null ? '—' : String(r.rollNo)],
                  ['Date of birth', r.dob ? fmtDate(r.dob) : '—'],
                  ['Gender', r.gender ? (GENDER[r.gender] ?? r.gender) : '—'],
                  ['Blood group', r.bloodGroup ?? '—'],
                  ['Admitted on', r.admissionDate ? fmtDate(r.admissionDate) : '—'],
                ] as [string, string][]
              ).map(([k, v]) => (
                <div key={k}>
                  <dt className="t-caption text-ink-2">{k}</dt>
                  <dd className="font-medium">{v}</dd>
                </div>
              ))}
            </dl>
          )}
        </QueryView>
      </CardBody>
    </Card>
  );
}

function StudentProfileBody() {
  const me = useMe();
  const l = useLearner();
  const profile = useMyProfile();
  const mine = profile.data?.emergencyContacts.find((e) => e.studentId === l.studentId)?.contacts ?? [];
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_21rem]">
      <div className="space-y-6">
        {profile.isPending ? (
          <Card><CardBody className="space-y-4" aria-busy="true"><Skeleton className="h-6 w-1/3" /><Skeleton className="h-9 w-full" /><Skeleton className="h-9 w-full" /><Skeleton className="h-9 w-full" /></CardBody></Card>
        ) : profile.isError && !profile.data ? (
          <Card><ErrorState error={profile.error} onRetry={() => void profile.refetch()} title="We couldn’t load your details" /></Card>
        ) : profile.data ? (
          <>
            <ContactDetailsForm profile={profile.data} />
            {l.studentId && <EmergencyContactsForm studentId={l.studentId} studentName={me.displayName} contacts={mine} parent={false} />}
          </>
        ) : null}
        {l.studentId && <CorrectionsPanel studentId={l.studentId} studentName={me.displayName} />}
      </div>
      <div className="space-y-6">
        <AvatarCard />
        {l.studentId && <RecordCard studentId={l.studentId} />}
        <SecurityCard />
      </div>
    </div>
  );
}

export function StudentProfileScreen() {
  return (
    <>
      <PageHeader title="My profile" description="Your details, photo and record corrections." />
      <MoreNav />
      <StudentProfileBody />
    </>
  );
}

/** /parent/more/profile: the parent's own contact details and, for the child on screen, the emergency contacts. */
export function ParentProfileScreen() {
  const l = useLearner();
  const profile = useMyProfile();
  const contacts = profile.data?.emergencyContacts.find((e) => e.studentId === l.studentId)?.contacts ?? [];
  return (
    <>
      <PageHeader title="Profile & contacts" description="Your contact details, and who the school can call about your child." />
      <MoreNav />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="space-y-6">
          {profile.isPending ? (
            <Card><CardBody className="space-y-4" aria-busy="true"><Skeleton className="h-6 w-1/3" /><Skeleton className="h-9 w-full" /><Skeleton className="h-9 w-full" /><Skeleton className="h-9 w-full" /></CardBody></Card>
          ) : profile.isError && !profile.data ? (
            <Card><ErrorState error={profile.error} onRetry={() => void profile.refetch()} title="We couldn’t load your details" /></Card>
          ) : profile.data ? (
            <>
              <ContactDetailsForm profile={profile.data} />
              {l.ready ? (
                <>
                  <ChildContext />
                  <EmergencyContactsForm key={l.studentId} studentId={l.studentId!} studentName={l.name} contacts={contacts} parent />
                </>
              ) : (
                <Card><CardBody><p className="text-sm text-ink-2">Emergency contacts appear here once the school has verified your link to a child.</p></CardBody></Card>
              )}
            </>
          ) : null}
        </div>
        <div className="space-y-6">
          <AvatarCard />
          <SecurityCard />
        </div>
      </div>
    </>
  );
}

export function ParentCorrectionsScreen() {
  const l = useLearner();
  return (
    <>
      <PageHeader title="Record corrections" description="Ask the school to fix an official detail on your child’s record." />
      <MoreNav />
      <FeatureGate perm="students:view" what="Record corrections">
        <NeedsLearner>
          <ChildContext />
          <div className="space-y-6">
            {l.studentId && <RecordCard studentId={l.studentId} />}
            {l.studentId && <CorrectionsPanel key={l.studentId} studentId={l.studentId} studentName={l.name} />}
          </div>
        </NeedsLearner>
      </FeatureGate>
    </>
  );
}
