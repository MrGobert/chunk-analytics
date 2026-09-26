'use client';

import { useState } from 'react';
import StatCard from '@/components/cards/StatCard';
import ChartCard from '@/components/cards/ChartCard';
import DataTable from '@/components/charts/DataTable';
import type { JourneyMetrics } from '@/types/mixpanel';

const percent = (value: number | null) => value == null ? '—' : `${(value * 100).toFixed(1)}%`;

export default function JourneyMetricsPanel({ data }: { data: JourneyMetrics }) {
  const [segment, setSegment] = useState<'byJourneyVersion' | 'byPlatform' | 'byDeviceFamily'>('byJourneyVersion');
  if (data.dataUnavailable) return <div className="mb-8 p-5 rounded-card border border-line text-ink-soft">New-user journey data is unavailable. No conversion or revenue estimate is shown.</div>;
  const median = data.medianMinutesToValue;
  const rows = data[segment].map((row) => ({
    segment: row.name, accounts: row.signups, mature24h: row.eligible24h, value: percent(row.successfulValueRate),
    mature7d: row.eligible7d, nonChat: percent(row.nonChatRate), matureD7: row.eligibleD7, returnD7: percent(row.returnD7Rate), mature30d: row.eligible30d,
  }));
  return (
    <section aria-label="Successful new-user journey" className="my-8">
      <h2 className="font-display text-2xl text-ink mb-2">Successful New-User Journey</h2>
      <p className="text-sm text-ink-soft mb-6">
        Native accounts created in the selected dates, followed across devices through {new Date(data.observedThrough).toLocaleString()}.
        {' '}Only explicit successful outcomes delivered to the user count. {data.instrumentedSignups} of {data.signups} accounts have journey instrumentation; legacy or uninstrumented accounts are excluded from successful-value denominators. Historical action-based activation remains available on the Activation page.
        {data.servedStale ? ' Showing a cached export; maturity is capped at its fetch time.' : ''}
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
        <StatCard title="Successful Value ≤24h" value={percent(data.successfulValueRate)} format="text" subtitle={`${data.successful24h} of ${data.eligible24h} mature accounts`} />
        <StatCard title="Median Time to Value" value={median == null ? '—' : median < 60 ? `${median.toFixed(1)}m` : `${(median / 60).toFixed(1)}h`} format="text" subtitle="Successful accounts within 24 hours" />
        <StatCard title="Non-Chat Adoption ≤7d" value={percent(data.nonChatRate)} format="text" subtitle={`${data.nonChat7d} of ${data.eligible7d} mature accounts`} />
        <StatCard title="Meaningful Day-7 Return" value={percent(data.returnD7Rate)} format="text" subtitle={`${data.returnedD7} of ${data.eligibleD7} accounts observed for 8 days`} />
      </div>
      <div className="flex flex-wrap gap-2 mb-4" aria-label="Journey segmentation">
        {([['byJourneyVersion', 'Journey Version'], ['byPlatform', 'Signup Platform'], ['byDeviceFamily', 'Device Family']] as const).map(([key, label]) => (
          <button key={key} onClick={() => setSegment(key)} aria-pressed={segment === key} className={`px-4 py-2 rounded-btn border text-sm ${segment === key ? 'border-ember/20 bg-ember-tint text-ember-deep' : 'border-line text-ink-soft'}`}>{label}</button>
        ))}
      </div>
      <div className="mb-6">
        <ChartCard title="Mature Signup Cohorts" subtitle="Separate denominators for each observation window; a dash means no mature accounts">
          <DataTable data={rows} columns={[
            { key: 'segment', header: 'Segment' }, { key: 'accounts', header: 'Accounts', numeric: true },
            { key: 'mature24h', header: '24h eligible', numeric: true }, { key: 'value', header: 'Value ≤24h', numeric: true },
            { key: 'mature7d', header: '7d eligible', numeric: true }, { key: 'nonChat', header: 'Non-chat', numeric: true },
            { key: 'matureD7', header: 'D7 eligible', numeric: true }, { key: 'returnD7', header: 'D7 return', numeric: true },
            { key: 'mature30d', header: '30d eligible', numeric: true },
          ]} />
        </ChartCard>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <ChartCard title="Explore Chunk" subtitle={`${data.tour.viewed} accounts viewed the tour · ${data.tour.dismissed} dismissed`}>
          <DataTable data={data.tour.actions} columns={[{ key: 'name', header: 'Selected task' }, { key: 'accounts', header: 'Accounts', numeric: true }]} />
        </ChartCard>
        <ChartCard title="Paywall Attribution" subtitle="Accounts with an exposure and subsequent outcome from that source within 30 days; includes legacy sources">
          <DataTable data={data.paywallSources} columns={[
            { key: 'source', header: 'Source' }, { key: 'viewed', header: 'Viewed', numeric: true },
            { key: 'dismissed', header: 'Dismissed', numeric: true }, { key: 'checkouts', header: 'Checkouts', numeric: true },
          ]} />
        </ChartCard>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-4">
        <StatCard title="Client Trials Started ≤30d" value={data.clientCheckouts30d.trials} subtitle={`${data.eligible30d} mature accounts · explicit trial metadata`} />
        <StatCard title="Client Non-Trial Checkouts" value={data.clientCheckouts30d.nonTrial} subtitle={`${data.clientCheckouts30d.unknown} checkouts have unknown trial status`} />
        <StatCard title="Paid Conversion ≤30d" value="Unavailable" format="text" subtitle="Requires authoritative transactions" />
        <StatCard title="30d Revenue / New Account" value="Unavailable" format="text" subtitle="Requires refunds and normalized currency" />
      </div>
      <p className="text-xs text-ink-faint mb-2">{data.revenueUnavailableReason}</p>
      <p className="text-xs text-ink-faint">Day-7 return means a delivered successful outcome between 7 and 8 elapsed days after signup. These observational cohorts do not establish a causal conversion lift.</p>
    </section>
  );
}
