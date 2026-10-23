'use client';

import * as React from 'react';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toaster';
import { peopleMessage } from './errors';
import { saveText, toCsv } from './csv';

type Cell = string | number | boolean | null | undefined;

/** CSV export built in the browser from the same filtered list (the API has no CSV endpoint for these lists). */
export function CsvExportButton({ build, filename, label = 'Export CSV', disabled, title }: { build: () => Promise<{ header: string[]; rows: Cell[][] }>; filename: string; label?: string; disabled?: boolean; title?: string }) {
  const [busy, setBusy] = React.useState(false);
  return (
    <Button
      variant="secondary"
      loading={busy}
      disabled={disabled}
      title={title}
      onClick={async () => {
        setBusy(true);
        try {
          const { header, rows } = await build();
          if (rows.length === 0) toast.message('Nothing to export for the current filters.');
          else {
            saveText(filename, toCsv(header, rows));
            toast.success(`Exported ${rows.length.toLocaleString()} ${rows.length === 1 ? 'row' : 'rows'}`);
          }
        } catch (e) {
          toast.error(peopleMessage(e), { duration: 8000 });
        } finally {
          setBusy(false);
        }
      }}
    >
      <Download /> {label}
    </Button>
  );
}
