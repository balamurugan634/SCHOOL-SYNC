'use client';

import * as React from 'react';
import type { Experience } from '@/lib/experience';
import { REPLAY_TOUR_EVENT } from './events';
import { isSetupAdmin } from '@/lib/permissions';
import { Button } from '../ui/button';
import { Dialog, DialogContent } from '../ui/dialog';
import { Illustration } from '../illustrations/illustration';
import { Stepper } from '../ui/stepper';
import { useMeContext } from '../me-context';
import { useSite } from '../site-context';

const KEY = (userId: string, exp: Experience, preview: boolean) => `ss:tour:v1:${preview ? 'preview:' : ''}${userId}:${exp}`;

interface TourStep {
  id: string;
  title: string;
  body: string;
}

function stepsFor(exp: Experience, schoolName: string, setupAdmin: boolean): TourStep[] {
  switch (exp) {
    case 'student':
      return [
        { id: 'home', title: `Welcome to ${schoolName}`, body: 'Home shows your day at a glance: today’s classes, homework that is due and what is coming up next.' },
        { id: 'tasks', title: 'My Tasks', body: 'Homework from your teachers and your own to-dos live in one list. Tick things off and hand work in before the deadline.' },
        { id: 'learn', title: 'Calendar and Learning', body: 'Check your timetable and exam dates, open study materials, and see results once the school has published them.' },
        { id: 'bell', title: 'Notifications and search', body: 'The bell collects announcements and reminders. Press Ctrl+K (⌘K on a Mac) to jump to any page.' },
      ];
    case 'parent':
      return [
        { id: 'home', title: `Welcome to ${schoolName}`, body: 'Home shows what matters for your child today: attendance, homework, upcoming events and anything the school needs from you.' },
        { id: 'child', title: 'Switching between children', body: 'Everything on screen follows the child selected at the top. Only children the school has verified as yours appear there.' },
        { id: 'sections', title: 'Attendance, Academics and Fees', body: 'Follow attendance and apply for leave, see homework and published results, and check dues and receipts.' },
        { id: 'bell', title: 'Notifications and search', body: 'Absence alerts, circulars and event reminders arrive in the bell. Press Ctrl+K (⌘K on a Mac) to jump to any page.' },
      ];
    case 'teacher':
      return [
        { id: 'home', title: `Welcome to ${schoolName}`, body: 'Home lists today’s periods, what needs your attention and your pending tasks for the classes you are assigned to.' },
        { id: 'attendance', title: 'Attendance', body: 'Open Attendance, pick your class and mark who is present. Parents of absent students are notified automatically.' },
        { id: 'work', title: 'Homework and Marks', body: 'Set homework, review submissions and enter marks for your subjects. Marks go through approval before students see them.' },
        { id: 'msg', title: 'Messages, events and search', body: 'Post to your classes, answer meeting requests and check the bell for anything new. Press Ctrl+K (⌘K on a Mac) to jump to any page.' },
      ];
    case 'management':
      return [
        { id: 'home', title: `Welcome to ${schoolName}`, body: 'The dashboard brings together the school’s key numbers. What you see depends on the roles you hold.' },
        { id: 'nav', title: 'Finding your way around', body: 'The sidebar groups the school into Academics, People, Finance, Communication, Operations, Reports and Settings. You only see what you can use.' },
        setupAdmin
          ? { id: 'setup', title: 'School setup', body: 'The School setup page lists what to configure — profile, classes, subjects, people, timetable and fees — and shows how far along you are.' }
          : { id: 'approve', title: 'Approvals', body: 'Leave requests, attendance corrections, marks and other approvals that need you will appear on your dashboard.' },
        { id: 'bell', title: 'Notifications and search', body: 'Notifications and your sessions are in the top bar. Press Ctrl+K (⌘K on a Mac) to jump to any page.' },
      ];
  }
}

export function WelcomeTour({ experience }: { experience: Experience }) {
  const { me, preview } = useMeContext();
  const site = useSite();
  const [open, setOpen] = React.useState(false);
  const [i, setI] = React.useState(0);
  const nextRef = React.useRef<HTMLButtonElement>(null);
  const steps = React.useMemo(() => stepsFor(experience, site?.shortName ?? site?.name ?? 'your school', isSetupAdmin(me)), [experience, site, me]);
  const key = KEY(me.id, experience, preview);

  React.useEffect(() => {
    try {
      if (!localStorage.getItem(key) && !me.mustChangePassword) {
        const t = setTimeout(() => setOpen(true), 600);
        return () => clearTimeout(t);
      }
    } catch {}
  }, [key, me.mustChangePassword]);

  React.useEffect(() => {
    const on = () => {
      setI(0);
      setOpen(true);
    };
    window.addEventListener(REPLAY_TOUR_EVENT, on);
    return () => window.removeEventListener(REPLAY_TOUR_EVENT, on);
  }, []);

  const finish = React.useCallback(() => {
    setOpen(false);
    try {
      localStorage.setItem(key, new Date().toISOString());
    } catch {}
  }, [key]);

  const step = steps[i]!;
  const last = i === steps.length - 1;

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : finish())}>
      <DialogContent
        title={step.title}
        description={step.body}
        className="max-w-sm"
        hideClose
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          nextRef.current?.focus();
        }}
      >
        {i === 0 && <Illustration name={`onboarding-${experience === 'management' ? 'management' : experience}`} role={experience} className="mx-auto mt-4 w-full max-w-[300px]" />}
        <div className="mt-5 flex items-center justify-between">
          <Stepper steps={steps.map((s) => ({ id: s.id, label: s.title }))} current={i} variant="dots" />
          <span className="text-xs text-muted-foreground">
            {i + 1} of {steps.length}
          </span>
        </div>
        <div className="mt-5 flex items-center justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={finish}>
            Skip tour
          </Button>
          <div className="flex items-center gap-2">
            {i > 0 && (
              <Button variant="secondary" size="sm" onClick={() => setI(i - 1)}>
                Back
              </Button>
            )}
            <Button ref={nextRef} size="sm" onClick={() => (last ? finish() : setI(i + 1))}>
              {last ? 'Done' : 'Next'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
