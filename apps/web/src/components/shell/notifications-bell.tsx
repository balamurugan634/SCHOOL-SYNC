'use client';

import { LiveNotificationsBell } from '../features/learner/comms/bell';

/** Top-bar bell (all roles): live unread count + latest notifications — implemented in features/learner/comms/bell.tsx. */
export function NotificationsBell() {
  return <LiveNotificationsBell />;
}
