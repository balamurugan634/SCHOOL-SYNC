'use client';

import * as React from 'react';
import { BellRing } from 'lucide-react';
import type { ShortageScanResult } from '@/lib/client/attendance-admin';
import { useShortageScan } from '@/lib/client/attendance-admin';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { fmtMonth, plural } from '@/lib/format';
import { Panel, DefList } from '../shared/detail';
import { useAccess } from '../shared/access';

/** "Run the shortage scan now": who is below the school's threshold, one alert per student per month. */
export function ShortageScanCard() {
  const a = useAccess();
  const scan = useShortageScan();
  const [confirm, setConfirm] = React.useState(false);
  const [result, setResult] = React.useState<ShortageScanResult | null>(null);
  // the API allows school-scope attendance approvers and editors
  const allowed = a.can('attendance:approve', 'school') || a.can('attendance:edit', 'school');
  const blocked = !allowed ? 'Your role does not allow this.' : a.readOnly ? 'The school is in read-only mode until the subscription is renewed.' : undefined;

  return (
    <Panel title="Attendance shortage" description="Find students below the school’s minimum attendance and alert their guardians.">
      <div className="space-y-4">
        <p className="text-sm text-ink-2">The scan also runs by itself every day. Run it now after a batch of corrections or a change to the threshold. Each student is alerted at most once a month, so running it twice is safe.</p>
        <Button variant="secondary" onClick={() => setConfirm(true)} disabled={!!blocked} title={blocked} loading={scan.isPending}>
          <BellRing /> Run shortage scan
        </Button>
        {result && (
          <div className="space-y-3" role="status" aria-live="polite">
            <Banner tone={result.belowThreshold === 0 ? 'success' : 'warning'} title={result.belowThreshold === 0 ? 'Nobody is below the threshold' : `${plural(result.belowThreshold, 'student')} below ${result.thresholdPercent}%`}>
              {result.alertsSent > 0 ? `${plural(result.alertsSent, 'new alert')} sent to guardians (${plural(result.notifications, 'notification')}).` : result.belowThreshold > 0 ? 'Everyone below the threshold was already alerted this month, so nothing new was sent.' : `${plural(result.checked, 'student')} checked.`}
            </Banner>
            <DefList
              items={[
                { label: 'Month', value: fmtMonth(result.month) },
                { label: 'Threshold', value: `${result.thresholdPercent}%` },
                { label: 'Students checked', value: result.checked.toLocaleString() },
                { label: 'Below threshold', value: result.belowThreshold.toLocaleString() },
                { label: 'New alerts sent', value: result.alertsSent.toLocaleString() },
              ]}
            />
          </div>
        )}
      </div>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Run the shortage scan now?"
        description="Every student whose attendance since the academic year began is below the school’s minimum will get one alert this month, and their verified guardians are notified straight away. Students already alerted this month are skipped."
        confirmLabel="Run scan"
        loading={scan.isPending}
        onConfirm={async () => {
          const r = await scan.go();
          if (r.ok) {
            setResult(r.data);
            setConfirm(false);
          } else setConfirm(false);
        }}
      />
    </Panel>
  );
}
