'use client';

import * as React from 'react';
import { Download } from 'lucide-react';
import type { PermissionKey } from '@school-sync/shared';
import { downloadBff, friendlyError, type Query } from '@/lib/client/mgmt';
import { toast } from '@/components/ui/toaster';
import { GuardedButton } from './guarded';
import { useMgmt } from './use-mgmt';

/**
 * CSV export from the API (`GET …/export` with the screen's own filters). Only users holding the export permission
 * can use it; everyone else sees a disabled button that says why. The API enforces the same rule.
 */
export function ExportButton({ path, query, filename, perm, label = 'Export CSV', disabledNote }: { path: string; query?: Query; filename: string; perm: PermissionKey; label?: string; disabledNote?: string }) {
  const { can } = useMgmt();
  const [busy, setBusy] = React.useState(false);
  const blocked = can(perm, 'school') ? null : (disabledNote ?? 'Exporting needs the export permission, which your role does not include.');
  return (
    <GuardedButton
      blocked={blocked}
      variant="secondary"
      size="sm"
      loading={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await downloadBff(path, query, filename);
          toast.success('Export ready', { description: filename });
        } catch (e) {
          toast.error(friendlyError(e, 'The export failed.'), { duration: 8000 });
        } finally {
          setBusy(false);
        }
      }}
    >
      <Download /> {label}
    </GuardedButton>
  );
}
