import type { Experience } from '@school-sync/shared';

/**
 * Notifications carry an API-client deep link (`data.route`, e.g. `/homework/<id>`). Map it to this app's page for the
 * signed-in experience. `null` = nothing sensible to open (the caller just marks the notification read).
 */
export function mapNotificationRoute(route: unknown, experience: Experience): string | null {
  if (typeof route !== 'string' || !route.startsWith('/')) return null;
  const [path = '', ...rest] = route.split('?');
  void rest;
  const seg = path.split('/').filter(Boolean);
  const [a, b, c] = seg;
  const id = b && b !== '…' ? b : null;
  if (experience === 'student') {
    const base = '/student';
    switch (a) {
      case 'homework': return id ? `${base}/learning/homework/${id}` : `${base}/learning?tab=homework`;
      case 'announcements': return id ? `${base}/announcements?open=${id}` : `${base}/announcements`;
      case 'events': return id ? `${base}/events?open=${id}` : `${base}/events`;
      case 'tasks': return `${base}/tasks`;
      case 'results': return id ? `${base}/learning/results/${id}` : `${base}/learning?tab=results`;
      case 'exams': return `${base}/learning?tab=exams`;
      case 'timetable': return `${base}/learning?tab=timetable`;
      case 'attendance': return `${base}/attendance`;
      case 'leave': return `${base}/attendance?tab=leave`;
      case 'fees': return b === 'invoices' && c ? `${base}/fees/${c}` : `${base}/fees`;
      case 'library': return `${base}/library`;
      case 'profile': return `${base}/profile`;
      case 'notifications': return `${base}/notifications`;
      default: return null;
    }
  }
  if (experience === 'parent') {
    const base = '/parent';
    switch (a) {
      case 'homework': return id ? `${base}/academics/homework/${id}` : `${base}/academics?tab=homework`;
      case 'announcements': return id ? `${base}/communication?tab=announcements&open=${id}` : `${base}/communication?tab=announcements`;
      case 'events': return id ? `${base}/communication?tab=events&open=${id}` : `${base}/communication?tab=events`;
      case 'meetings': return `${base}/communication?tab=meetings`;
      case 'results': return id ? `${base}/academics/results/${id}` : `${base}/academics?tab=results`;
      case 'exams': return `${base}/academics?tab=exams`;
      case 'timetable': return `${base}/academics?tab=timetable`;
      case 'attendance': return `${base}/attendance`;
      case 'leave': return `${base}/attendance?tab=leave`;
      case 'fees': return b === 'invoices' && c ? `${base}/fees/${c}` : `${base}/fees`;
      case 'library': return `${base}/more/library`;
      case 'profile': return `${base}/more/profile`;
      case 'notifications': return `${base}/communication?tab=notifications`;
      default: return null;
    }
  }
  return null;
}

/** Where "View all" goes; staff have no inbox page yet. */
export const inboxHref = (experience: Experience): string | null => (experience === 'student' ? '/student/notifications' : experience === 'parent' ? '/parent/communication?tab=notifications' : null);
export const preferencesHref = (experience: Experience): string | null => (experience === 'student' ? '/student/notifications/preferences' : experience === 'parent' ? '/parent/communication/preferences' : null);
