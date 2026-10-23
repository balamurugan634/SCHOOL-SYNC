'use client';

import { Lock } from 'lucide-react';
import type { UserOut } from '@school-sync/shared';
import { Badge, StatusChip } from '@/components/ui/badge';
import { ApiError } from '@/lib/problem';

export const USER_TYPE_LABEL: Record<string, string> = { staff: 'Staff', student: 'Student', parent: 'Parent' };

/** Account status as icon + label. `deactivated` and `invited` have no stock chip, so they map onto neutral ones. */
export function UserStatus({ user }: { user: Pick<UserOut, 'status' | 'locked'> }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {user.status === 'deactivated' ? <StatusChip status="cancelled" label="Deactivated" /> : user.status === 'invited' ? <StatusChip status="scheduled" label="Not signed in yet" /> : <StatusChip status={user.status} />}
      {user.locked && (
        <Badge variant="danger" icon={<Lock aria-hidden />}>
          Locked
        </Badge>
      )}
    </span>
  );
}

/** Plain-language messages for the account / role API codes. */
export function accessErrorMessage(e: unknown): string | null {
  if (!(e instanceof ApiError)) return null;
  switch (e.code) {
    case 'CANNOT_MODIFY_SELF':
      return 'You cannot do this to your own account. Ask another administrator.';
    case 'ONLY_SUPER_ADMIN':
      return 'Only a super administrator can manage a super administrator account.';
    case 'ROLES_EDIT_REQUIRED':
      return 'Assigning roles needs the “edit roles” permission, which your role does not have.';
    case 'CANNOT_GRANT_BEYOND_OWN_ACCESS':
      return `You cannot grant access you do not hold yourself${e.detail ? ` (${e.detail.replace(/^.*yourself:\s*/, '')})` : ''}.`;
    case 'SUPER_ADMIN_LOCKED':
      return 'The super administrator role always keeps every permission and cannot be edited.';
    case 'ROLE_NOT_ALLOWED_FOR_USER_TYPE':
      return 'That role cannot be given to this kind of account (for example a student role on a staff login).';
    case 'USERNAME_TAKEN':
      return 'That username is already taken. Choose another.';
    case 'EMAIL_TAKEN':
      return 'That email address already belongs to another account.';
    case 'PHONE_TAKEN':
      return 'That phone number already belongs to another account.';
    case 'ROLE_KEY_RESERVED':
    case 'ROLE_KEY_TAKEN':
      return 'A role with a very similar name already exists. Choose a different name.';
    case 'ROLE_IN_USE':
      return 'People still hold this role. Remove it from them first.';
  }
  return null;
}
