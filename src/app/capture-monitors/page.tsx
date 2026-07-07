'use client';

import { useEffect, useRef } from 'react';
import { useDashboardFilters } from '@/hooks/useDashboardFilters';
import gsap from 'gsap';
import PageHeader from '@/components/layout/PageHeader';
import StatCard from '@/components/cards/StatCard';
import ChartCard from '@/components/cards/ChartCard';
import FunnelChart from '@/components/charts/FunnelChart';
import BarChart from '@/components/charts/BarChart';
import PieChart from '@/components/charts/PieChart';
import LineChart from '@/components/charts/LineChart';
import DataTable from '@/components/charts/DataTable';
import { SkeletonPage } from '@/components/ui/Skeleton';
import { useAnalytics } from '@/hooks/useAnalytics';
import type { CaptureMonitorsMetrics } from '@/types/mixpanel';
import { chart } from '@/lib/chartTheme';
import { Eye, Inbox, CheckCircle, Radio, Lightbulb, PlayCircle, Ban, Lock } from 'lucide-react';

// Friendlier labels for the raw capture-source values.
const SOURCE_LABEL: Record<string, string> = {
  clipper: 'Browser clip',
  share_ios: 'iOS share',
  share_mac: 'macOS share',
  web: 'Web',
  email: 'Email',
  app_intent: 'App intent',
};

export default function CaptureMonitorsPage() {
  const { dateRange, setDateRange, platform, setPlatform } = useDashboardFilters();
  const containerRef = useRef<HTMLDivElement>(null);

  const { data, isLoading, isRefreshing, lastUpdated, error } =
    useAnalytics<CaptureMonitorsMetrics>('/api/metrics/capture-monitors', {
      range: dateRange,
      platform,
    });

  const hasAnimated = useRef(false);
  useEffect(() => {
    if (hasAnimated.current || isLoading || !data) return;
    hasAnimated.current = true;
    const ctx = gsap.context(() => {
      const mm = gsap.matchMedia();
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        gsap.fromTo(
          '.card-animate',
          { y: 28, opacity: 0 },
          { y: 0, opacity: 1, duration: 0.8, stagger: 0.06, ease: 'power3.out' },
        );
      });
    }, containerRef);
    return () => ctx.revert();
  }, [isLoading, data]);

  if (isLoading) {
    return (
      <SkeletonPage
        statCards={8}
        statCardCols="grid-cols-1 md:grid-cols-2 lg:grid-cols-4"
        chartCards={12}
      />
    );
  }
  if (error || !data) {
    return (
      <div className="empty-state py-20">{error || 'Failed to load capture & monitors data.'}</div>
    );
  }

  const bySource = data.capturesBySource.map((s) => ({
    name: SOURCE_LABEL[s.name] ?? s.name,
    value: s.value,
  }));

  return (
    <div ref={containerRef} className="animate-in fade-in duration-300">
      <PageHeader
        title="Capture & Automations"
        subtitle="What users save to Chunk and the automations they set on the topics they watch"
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
        platform={platform}
        onPlatformChange={setPlatform}
        lastUpdated={lastUpdated}
        isRefreshing={isRefreshing}
      />

      {/* KPI row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <div className="card-animate">
          <StatCard title="Captures" value={data.capturesTotal} subtitle="Save-to-Chunk actions" icon={<Inbox className="w-5 h-5" />} />
        </div>
        <div className="card-animate">
          <StatCard title="Automations Created" value={data.monitorsCreated} subtitle="Standing research agents" icon={<Eye className="w-5 h-5" />} />
        </div>
        <div className="card-animate">
          <StatCard title="Keep Rate" value={data.keepRate} format="percentage" subtitle="Accepted or filed vs discarded" icon={<CheckCircle className="w-5 h-5" />} />
        </div>
        <div className="card-animate">
          <StatCard title="Active Sources" value={data.activeSources} subtitle="Capture entry points in use" icon={<Radio className="w-5 h-5" />} />
        </div>
      </div>

      {/* Automation health KPI row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <div className="card-animate">
          <StatCard title="Suggestion Accept Rate" value={data.suggestionAcceptRate} format="percentage" subtitle="Accepted vs shown" icon={<Lightbulb className="w-5 h-5" />} />
        </div>
        <div className="card-animate">
          <StatCard title="Runs Viewed" value={data.runsViewed} subtitle="Automation runs opened" icon={<PlayCircle className="w-5 h-5" />} />
        </div>
        <div className="card-animate">
          <StatCard title="Limit Hits" value={data.limitHits} subtitle="Hit the plan's automation cap" icon={<Ban className="w-5 h-5" />} />
        </div>
        <div className="card-animate">
          <StatCard title="Paywalls Shown" value={data.paywallsShown} subtitle="Upgrade prompts surfaced" icon={<Lock className="w-5 h-5" />} />
        </div>
      </div>

      {/* Daily trend */}
      <div className="grid grid-cols-1 gap-6 mb-8">
        <div className="card-animate">
          <ChartCard title="Daily Activity" subtitle="Captures and automations created per day">
            {data.dailyTrend.length > 0 ? (
              <LineChart
                data={data.dailyTrend}
                xKey="date"
                showLegend
                lines={[
                  { key: 'captures', color: chart.series[0], name: 'Captures' },
                  { key: 'monitors', color: chart.series[1], name: 'Automations' },
                ]}
              />
            ) : (
              <div className="empty-state h-full">No activity in range</div>
            )}
          </ChartCard>
        </div>
      </div>

      {/* Captures: by source + content type */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <div className="card-animate">
          <ChartCard title="Captures by Source" subtitle="Browser clip · iOS/macOS share · web · email">
            {bySource.length > 0 ? (
              <BarChart data={bySource} xKey="name" yKey="value" horizontal color={chart.series[0]} />
            ) : (
              <div className="empty-state h-full">No captures yet</div>
            )}
          </ChartCard>
        </div>
        <div className="card-animate">
          <ChartCard title="Captures by Content Type" subtitle="URL · text · image · PDF">
            {data.capturesByContentType.length > 0 ? (
              <PieChart data={data.capturesByContentType} />
            ) : (
              <div className="empty-state h-full">No captures yet</div>
            )}
          </ChartCard>
        </div>
      </div>

      {/* Triage funnel + outcomes */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <div className="card-animate">
          <ChartCard title="Triage Funnel" subtitle="Captured → triaged → kept">
            <FunnelChart data={data.triageFunnel} />
          </ChartCard>
        </div>
        <div className="card-animate">
          <ChartCard title="Triage Outcomes" subtitle="How captured items are resolved">
            {data.triageOutcomes.length > 0 ? (
              <PieChart data={data.triageOutcomes} />
            ) : (
              <div className="empty-state h-full">Nothing triaged yet</div>
            )}
          </ChartCard>
        </div>
      </div>

      {/* Automations: kind + lifecycle */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <div className="card-animate">
          <ChartCard title="Automations by Kind" subtitle="Research · watcher · agent task · digest">
            {data.kindMix.length > 0 ? (
              <PieChart data={data.kindMix} />
            ) : (
              <div className="empty-state h-full">No automations yet</div>
            )}
          </ChartCard>
        </div>
        <div className="card-animate">
          <ChartCard title="Automation Lifecycle" subtitle="Created · edited · paused · resumed · run · deleted">
            {data.lifecycleActions.length > 0 ? (
              <BarChart data={data.lifecycleActions} xKey="name" yKey="value" color={chart.series[1]} />
            ) : (
              <div className="empty-state h-full">No automation activity yet</div>
            )}
          </ChartCard>
        </div>
      </div>

      {/* Automation suggestions: funnel + outcomes */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <div className="card-animate">
          <ChartCard title="Suggestion Funnel" subtitle="Suggested → accepted">
            <FunnelChart data={data.suggestionFunnel} />
          </ChartCard>
        </div>
        <div className="card-animate">
          <ChartCard title="Suggestion Outcomes" subtitle="Accepted vs dismissed">
            {data.suggestionOutcomes.length > 0 ? (
              <PieChart data={data.suggestionOutcomes} />
            ) : (
              <div className="empty-state h-full">No suggestions yet</div>
            )}
          </ChartCard>
        </div>
      </div>

      {/* Automation creation path: kind-selection source + top recipes */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <div className="card-animate">
          <ChartCard title="Kind-Selection Source" subtitle="Manual · intent classifier · recipe · chat suggestion">
            {data.kindSelectSource.length > 0 ? (
              <PieChart data={data.kindSelectSource} />
            ) : (
              <div className="empty-state h-full">No kind selections yet</div>
            )}
          </ChartCard>
        </div>
        <div className="card-animate">
          <ChartCard title="Top Agent-Task Recipes" subtitle="Recipes chosen when building agent tasks">
            {data.topRecipes.length > 0 ? (
              <DataTable
                data={data.topRecipes}
                columns={[
                  { key: 'recipe', header: 'Recipe' },
                  { key: 'count', header: 'Selected', numeric: true },
                ]}
              />
            ) : (
              <div className="empty-state py-10">No recipes selected yet</div>
            )}
          </ChartCard>
        </div>
      </div>

      {/* Automation runs + plan previews */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <div className="card-animate">
          <ChartCard title="Run Status" subtitle="Outcome of runs users opened">
            {data.runStatusMix.length > 0 ? (
              <PieChart data={data.runStatusMix} />
            ) : (
              <div className="empty-state h-full">No runs viewed yet</div>
            )}
          </ChartCard>
        </div>
        <div className="card-animate">
          <ChartCard title="Agent-Task Plan Steps" subtitle="Step count when previewing a plan">
            {data.planStepMix.length > 0 ? (
              <BarChart data={data.planStepMix} xKey="name" yKey="value" color={chart.series[3]} />
            ) : (
              <div className="empty-state h-full">No plans previewed yet</div>
            )}
          </ChartCard>
        </div>
      </div>

      {/* Automations: cadence + report type */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <div className="card-animate">
          <ChartCard title="Automation Cadence" subtitle="How often automations re-run">
            {data.cadenceMix.length > 0 ? (
              <PieChart data={data.cadenceMix} />
            ) : (
              <div className="empty-state h-full">No automations yet</div>
            )}
          </ChartCard>
        </div>
        <div className="card-animate">
          <ChartCard title="Automation Report Depth" subtitle="Report type chosen">
            {data.reportTypeMix.length > 0 ? (
              <BarChart data={data.reportTypeMix} xKey="name" yKey="value" color={chart.series[2]} />
            ) : (
              <div className="empty-state h-full">No automations yet</div>
            )}
          </ChartCard>
        </div>
      </div>

      {/* Capture setup activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <div className="card-animate">
          <ChartCard title="Capture Setup" subtitle="Clipper tokens and email aliases">
            {data.captureSetup.length > 0 ? (
              <BarChart data={data.captureSetup} xKey="name" yKey="value" horizontal color={chart.series[0]} />
            ) : (
              <div className="empty-state h-full">No capture setup yet</div>
            )}
          </ChartCard>
        </div>
        <div className="card-animate">
          <ChartCard title="Inbox Engagement" subtitle="How often the inbox is opened">
            <div className="flex items-center justify-center h-full">
              <StatCard title="Inbox Views" value={data.inboxViews} subtitle="Inbox opened" icon={<Inbox className="w-5 h-5" />} />
            </div>
          </ChartCard>
        </div>
      </div>

      {/* Top topics */}
      <div className="grid grid-cols-1 gap-6">
        <div className="card-animate">
          <ChartCard title="Top Automation Topics" subtitle="What users watch — the 'topic to watch' (truncated)">
            {data.topTopics.length > 0 ? (
              <DataTable
                data={data.topTopics}
                columns={[
                  { key: 'topic', header: 'Topic' },
                  { key: 'count', header: 'Automations', numeric: true },
                ]}
              />
            ) : (
              <div className="empty-state py-10">No automation topics yet</div>
            )}
          </ChartCard>
        </div>
      </div>
    </div>
  );
}
