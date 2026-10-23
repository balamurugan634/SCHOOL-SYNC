'use client';

import * as React from 'react';
import { Banner } from '@/components/ui/banner';
import { ApiError, errorMessage } from '@/lib/problem';

/** What a failed people action means, in plain words. `steps` = what the user can do next. */
export interface Explained {
  title?: string;
  message: string;
  steps?: string[];
}

const SEAT_RE = /\((\d+)\/(\d+)(?: for ([^)]+))?\)/;

export function explainError(e: unknown): Explained {
  if (!(e instanceof ApiError)) return { message: errorMessage(e) };
  switch (e.code) {
    case 'LICENSE_LIMIT_REACHED': {
      const m = SEAT_RE.exec(e.detail ?? '');
      const used = m?.[1];
      const licensed = m?.[2];
      const year = m?.[3];
      return {
        title: 'The school has used all of its student seats',
        message: `${licensed ? `The subscription covers ${licensed} students${year ? ` for ${year}` : ''}` : 'The subscription’s student limit'} and ${used ?? 'that many'} are already on the roll, so another student cannot be added. Nothing was saved.`,
        steps: ['Ask the platform operator to add seats to the subscription, then try again.', 'Or archive students who have left (transferred, withdrawn or alumni) to free seats.', 'Existing students, staff and parents are not affected.'],
      };
    }
    case 'SUBSCRIPTION_EXPIRED':
      return {
        title: 'The subscription has expired',
        message: 'The school is in read-only mode, so students cannot be added or changed until the subscription is renewed. Nothing was saved.',
        steps: ['Ask the platform operator to renew the subscription.', 'You can still view and export records meanwhile.'],
      };
    case 'SECTION_FULL':
      return { title: 'That section is full', message: `${e.detail ?? 'The section has reached its capacity.'} Pick another section, or raise the capacity under Classes & sections.` };
    case 'SECTION_NOT_CURRENT_YEAR':
      return { message: 'Choose a section of the current academic year. Sections of other years cannot take new students.' };
    case 'PHONE_TAKEN':
      return { message: `${e.detail ?? 'That phone number is already used by another account.'} If it is the same parent, link the existing parent instead of creating a new one.` };
    case 'EMAIL_TAKEN':
      return { message: `${e.detail ?? 'That email address is already used by another account.'} Use a different address, or leave it empty.` };
    case 'USERNAME_TAKEN':
      return { message: `${e.detail ?? 'That username is already in use.'} Choose a different username.` };
    case 'GUARDIAN_EXISTS':
      return { message: 'A parent with this phone number is already registered. Link that parent instead of creating a new record.' };
    case 'GUARDIAN_HAS_LINKS':
      return { message: 'This parent is still linked to students. Unlink them from every student first, then remove the parent.' };
    case 'GUARDIAN_HAS_LOGIN':
      return { message: 'This parent already has a login. Use Reset password in Settings → Users if they cannot sign in.' };
    case 'CONTACT_REQUIRED':
      return { message: 'Add a phone number or email first. It becomes the parent’s username.' };
    case 'LINK_EXISTS':
      return { message: 'This parent is already linked to the student.' };
    case 'STUDENT_NOT_ACTIVE':
      return { message: 'That student is not currently at the school.' };
    case 'INVALID_STATE':
      return { message: e.detail ?? 'This is not possible in the record’s current state.' };
    case 'INVALID_TRANSITION':
      return { message: e.detail ?? 'That status change is not allowed from the current status.' };
    case 'CANNOT_REINSTATE':
      return { message: 'This student has no open place this year to return to. Re-admit them through Admissions instead.' };
    case 'NOT_ENROLLED':
      return { message: 'The student has no enrollment in the current academic year, so they cannot be moved.' };
    case 'SAME_SECTION':
      return { message: 'The student is already in that section.' };
    case 'STAFF_HAS_ASSIGNMENTS':
      return { title: 'This person still has classes', message: `${e.detail ?? 'They lead a section or teach a subject.'} Reassign them first, or tick “Also release their assignments” to remove them automatically.` };
    case 'STAFF_HAS_LOGIN':
      return { message: 'This staff member already has a login.' };
    case 'NO_LOGIN':
      return { message: 'This staff member has no login yet, so there is nothing to assign roles to.' };
    case 'CANNOT_MODIFY_SELF':
      return { message: 'You cannot do this to your own account. Ask another administrator.' };
    case 'ALREADY_DEACTIVATED':
      return { message: 'This staff member is already deactivated.' };
    case 'ROLES_EDIT_REQUIRED':
      return { message: 'Giving someone a role other than Teacher needs permission to edit roles. Ask a super administrator, or create the staff member without extra roles.' };
    case 'ONLY_SUPER_ADMIN':
      return { message: 'Only a super administrator can give out the super administrator role.' };
    case 'CANNOT_GRANT_BEYOND_OWN_ACCESS':
      return { message: 'You can only give a role that does not exceed your own access.' };
    case 'ROLE_NOT_FOUND':
      return { message: 'One of the selected roles no longer exists. Reload the page and try again.' };
    case 'ROLE_NOT_ALLOWED_FOR_USER_TYPE':
      return { message: 'That role cannot be given to this kind of account.' };
    case 'ALREADY_DECIDED':
    case 'NOT_PENDING':
      return { message: 'Someone has already decided this request. Reload to see the latest.' };
    case 'NOTE_REQUIRED':
      return { message: 'A note is required for this decision.' };
    case 'NO_CHANGE':
      return { message: 'The proposed values are the same as the current record, so there is nothing to apply.' };
    case 'ALREADY_ENROLLED':
      return { message: 'This application has already been enrolled.' };
    case 'ADMISSION_NOT_ACCEPTED':
      return { message: 'Only accepted applications can be enrolled. Accept the application first.' };
    case 'GRADE_MISMATCH':
      return { message: 'That section belongs to a different grade than the one applied for. Choose a section of the applied grade.' };
    case 'EMPTY_IMPORT':
      return { message: 'There is nothing to import. The sheet needs a header row and at least one student.' };
    case 'MISSING_COLUMNS':
      return { message: 'The header row must include a first-name column (for example “First Name”). Check the template.' };
    case 'TOO_MANY_ROWS':
      return { message: e.detail ?? 'Import at most 500 students at a time. Split the file and import it in parts.' };
    case 'IMPORT_HAS_ERRORS':
      return { message: `${e.detail ?? 'Some rows have errors.'} Nothing was imported.` };
    case 'NOTHING_TO_IMPORT':
      return { message: 'There are no valid rows to import.' };
    case 'FORBIDDEN':
      return { message: e.detail ?? 'Your role does not allow this.' };
    case 'UNSUPPORTED_MEDIA_TYPE':
    case 'FILE_TYPE_NOT_ALLOWED':
      return { message: 'That file type is not accepted. Use a PDF, JPG, PNG or WebP file.' };
    case 'FILE_TOO_LARGE':
    case 'PAYLOAD_TOO_LARGE':
      return { message: 'That file is too large. Use a smaller file (under 10 MB).' };
  }
  if (e.status === 403) return { message: 'Your role does not allow this. The API refused it.' };
  if (e.status === 413) return { message: 'That file is too large. Use a smaller file (under 10 MB).' };
  if (e.status === 415) return { message: 'That file type is not accepted. Use a PDF, JPG, PNG or WebP file.' };
  return { message: errorMessage(e) };
}

/** One-line message for a toast. */
export const peopleMessage = (e: unknown): string => explainError(e).message;

/** A danger banner that explains a failed action (seat limit, read-only school, duplicates …) and what to do next. */
export function ErrorBanner({ error, className }: { error: unknown; className?: string }) {
  if (!error) return null;
  const x = explainError(error);
  return (
    <Banner tone={error instanceof ApiError && error.code === 'SUBSCRIPTION_EXPIRED' ? 'locked' : 'danger'} title={x.title} className={className}>
      <p>{x.message}</p>
      {x.steps && (
        <ul className="mt-1.5 list-disc space-y-0.5 pl-4">
          {x.steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      )}
    </Banner>
  );
}
