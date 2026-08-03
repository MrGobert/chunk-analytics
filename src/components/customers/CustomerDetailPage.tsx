'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import gsap from 'gsap';
import { useAnalytics } from '@/hooks/useAnalytics';
import {
  emailEngagementScore,
  recoverTenureFactor,
} from '@/lib/customer-health';
import type {
  CustomerDetail,
  CustomerHealthFactors,
  CustomerUsageStats,
  UserActivityMetrics,
} from '@/types/mixpanel';
import { ArrowLeft, Search, FileText, Image as ImageIcon, StickyNote, FolderOpen, Inbox, Zap, Shapes, Mail, CreditCard, UserX, Activity, BadgeCheck } from 'lucide-react';

const FACTOR_META: { key: keyof NonNullable<CustomerDetail['healthFactors']>; label: string; weight: number }[] = [
  { key: 'recency', label: 'Recency', weight: 35 },
  { key: 'frequency', label: 'Usage Frequency', weight: 25 },
  { key: 'featureDepth', label: 'Feature Depth', weight: 20 },
  { key: 'tenure', label: 'Tenure', weight: 10 },
  { key: 'emailEngagement', label: 'Email Engagement', weight: 10 },
];

function healthColor(score: number) {
  return score >= 60 ? 'text-sage-deep' : score >= 30 ? 'text-[#C8922A]' : 'text-ember-deep';
}
function healthBg(score: number) {
  return score >= 60 ? 'bg-sage' : score >= 30 ? 'bg-butter' : 'bg-ember';
}

function fmtDate(s?: string | null) {
  if (!s) return '—';
  const d = new Date(s);
  return isNaN(d.getTime()) ? s : d.toLocaleDateString();
}

function fmtLabel(s?: string | null) {
  if (!s) return '';
  return s.replace(/_/g, ' ');
}

const USAGE_KEYS: (keyof CustomerUsageStats)[] = [
  'searches',
  'documents',
  'images',
  'notes',
  'collections',
  'captures',
  'automations',
  'artifacts',
];

function latestDate(first?: string | null, second?: string | null) {
  const firstTime = first ? Date.parse(first) : NaN;
  const secondTime = second ? Date.parse(second) : NaN;
  if (Number.isNaN(firstTime)) return second || '';
  if (Number.isNaN(secondTime)) return first || '';
  return secondTime > firstTime ? second || '' : first || '';
}

function mixpanelRecency(lastSeen?: string | null) {
  if (!lastSeen) return 0;
  const timestamp = Date.parse(lastSeen);
  if (Number.isNaN(timestamp)) return 0;
  const daysSince = Math.max(0, (Date.now() - timestamp) / 86_400_000);
  return Math.max(0, 100 - daysSince * 3.3);
}

function enrichHealthFactors(
  factors: CustomerHealthFactors | null | undefined,
  activity: UserActivityMetrics | null,
  emailHistory: CustomerDetail['emailHistory'],
  usage: CustomerUsageStats | null,
) {
  if (!factors) return null;
  const enriched = { ...factors };

  if (activity && !activity.dataUnavailable) {
    const recoveredRecency = mixpanelRecency(activity.lastSeen);
    enriched.recency = Math.round(Math.max(
      factors.recency,
      recoveredRecency,
    ));
    // The backend halves tenure when it has no recency signal. Undo that gate
    // when Mixpanel supplies the missing activity timestamp.
    enriched.tenure = recoverTenureFactor(
      factors.tenure,
      factors.recency,
      recoveredRecency,
    );
    enriched.frequency = Math.round(
      Math.max(factors.frequency, Math.min(100, (activity.usageStats?.searches ?? 0) * 5)),
    );
  }

  if (usage) {
    const featureCount = USAGE_KEYS.filter(
      (key) => (usage[key] ?? 0) > 0,
    ).length;
    enriched.featureDepth = Math.round(
      featureCount * 100 / USAGE_KEYS.length,
    );
  }

  const actualEmailEngagement = emailEngagementScore(emailHistory);
  if (actualEmailEngagement != null) {
    enriched.emailEngagement = actualEmailEngagement;
  }

  return enriched;
}

function scoreHealthFactors(factors: CustomerHealthFactors | null, fallback: number | null) {
  if (!factors) return fallback;
  return Math.round(
    factors.recency * 0.35 +
    factors.frequency * 0.25 +
    factors.featureDepth * 0.20 +
    factors.tenure * 0.10 +
    factors.emailEngagement * 0.10,
  );
}

function ActivityCard({
  activity,
  isLoading,
  error,
}: {
  activity: UserActivityMetrics | null;
  isLoading: boolean;
  error: string | null;
}) {
  return (
    <div className="card-animate card-surface p-6 sm:p-8">
      <div className="flex items-center gap-2 mb-1">
        <Activity className="w-5 h-5 text-ink-faint" />
        <h3 className="font-display text-xl text-ink">Activity</h3>
      </div>
      <p className="text-sm font-mono text-ink-faint mb-5">
        Mixpanel events · last 30 days
        {activity?.servedStale ? ` · cached ${fmtDate(activity.dataAsOf)}` : ''}
      </p>
      {isLoading ? (
        <div className="skeleton h-24 rounded-chip" />
      ) : error || !activity || activity.dataUnavailable ? (
        <div className="empty-state py-8">Activity data temporarily unavailable</div>
      ) : activity.totalEvents === 0 ? (
        <div className="empty-state py-8">No Mixpanel events in range</div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-4 mb-5">
            <div className="rounded-chip bg-paper-deep border border-line p-4">
              <div className="font-mono text-2xl text-ink tabular-nums">{activity.totalEvents}</div>
              <div className="text-xs text-ink-soft mt-0.5">Events</div>
            </div>
            <div className="rounded-chip bg-paper-deep border border-line p-4">
              <div className="font-mono text-2xl text-ink tabular-nums">{activity.activeDays}</div>
              <div className="text-xs text-ink-soft mt-0.5">Active days</div>
            </div>
            <div className="rounded-chip bg-paper-deep border border-line p-4">
              <div className="font-mono text-sm text-ink pt-1.5">{fmtDate(activity.lastSeen)}</div>
              <div className="text-xs text-ink-soft mt-1.5">Last seen</div>
            </div>
          </div>
          {activity.byCategory.length > 0 && (
            <div className="space-y-2">
              {activity.byCategory.map((c) => (
                <div key={c.category} className="flex items-center justify-between text-sm">
                  <span className="text-ink-soft capitalize">{fmtLabel(c.category)}</span>
                  <span className="font-mono text-ink tabular-nums">{c.events}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function CustomerDetailPage({ uid }: { uid: string }) {
  const containerRef = useRef<HTMLDivElement>(null);

  const { data, isLoading, error } = useAnalytics<CustomerDetail>(
    '/api/rc/customer-detail',
    { uid },
  );
  const {
    data: activity,
    isLoading: isActivityLoading,
    error: activityError,
  } = useAnalytics<UserActivityMetrics>('/api/metrics/user-activity', { uid, range: '30d' });

  useEffect(() => {
    if (!data) return;
    const ctx = gsap.context(() => {
      const mm = gsap.matchMedia();
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        gsap.fromTo('.card-animate', { y: 28, opacity: 0 }, { y: 0, opacity: 1, duration: 0.8, stagger: 0.06, ease: 'power3.out' });
      });
    }, containerRef);
    return () => ctx.revert();
  }, [data]);

  const backLink = (
    <Link href="/customers" className="inline-flex items-center gap-2 text-sm text-ink-soft hover:text-ink transition-colors mb-6">
      <ArrowLeft className="w-4 h-4" /> Back to Customers
    </Link>
  );

  if (isLoading) {
    return (
      <div className="animate-in fade-in duration-200">
        {backLink}
        <div className="skeleton h-40 rounded-card mb-6" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="skeleton h-64 rounded-card" />
          <div className="skeleton h-64 rounded-card" />
        </div>
      </div>
    );
  }

  if (error || !data || data.error) {
    const hasMixpanelActivity = !!activity && !activity.dataUnavailable && activity.totalEvents > 0;
    return (
      <div ref={containerRef} className="animate-in fade-in duration-200">
        {backLink}
        <div className="card-surface p-10 text-center mb-6">
          <UserX className="w-10 h-10 text-ink-faint mx-auto mb-3" />
          <p className="text-ink font-medium">No customer profile found</p>
          <p className="text-ink-faint text-sm font-mono mt-2">{error || data?.error || `No record for ${uid}`}</p>
          <p className="text-ink-soft text-sm mt-3">
            {hasMixpanelActivity
              ? 'This id has Mixpanel activity but no linked Firebase profile.'
              : 'This may be a guest/anonymous id with no subscription record.'}
          </p>
        </div>
        {hasMixpanelActivity && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <ActivityCard
              activity={activity}
              isLoading={isActivityLoading}
              error={activityError}
            />
          </div>
        )}
      </div>
    );
  }

  const activityAvailable = !!activity && !activity.dataUnavailable;
  const mixpanelUsage = activityAvailable ? activity.monthToDateUsageStats : {};
  const usage = Object.fromEntries(
    USAGE_KEYS.map((key) => [
      key,
      Math.max(data.usageStats?.[key] ?? 0, mixpanelUsage?.[key] ?? 0),
    ]),
  ) as CustomerUsageStats;
  const usageAvailable = data.hasUsageStats !== false || activityAvailable;
  const firestoreUsageIncomplete =
    data.hasUsageStats === false || Boolean(data.usageStatsUnavailableFields?.length);
  const healthFactors = enrichHealthFactors(
    data.healthFactors,
    activity,
    data.emailHistory || [],
    usageAvailable ? usage : null,
  );
  const healthScore = scoreHealthFactors(healthFactors, data.healthScore);
  const lastActiveAt = latestDate(data.lastActiveAt, activityAvailable ? activity.lastSeen : null);
  const usageItems = [
    { label: 'Searches', value: usage.searches ?? 0, icon: Search },
    { label: 'Documents', value: usage.documents ?? 0, icon: FileText },
    { label: 'Images', value: usage.images ?? 0, icon: ImageIcon },
    { label: 'Notes', value: usage.notes ?? 0, icon: StickyNote },
    { label: 'Collections', value: usage.collections ?? 0, icon: FolderOpen },
    { label: 'Captures', value: usage.captures ?? 0, icon: Inbox },
    { label: 'Automations', value: usage.automations ?? 0, icon: Zap },
    { label: 'Artifacts', value: usage.artifacts ?? 0, icon: Shapes },
  ];
  const sub = data.currentSubscription;
  const subscriptionHasAccess = sub?.isSubscribed ??
    (sub?.status === 'active' || sub?.status === 'trial' || sub?.status === 'trialing');

  return (
    <div ref={containerRef} className="animate-in fade-in duration-300">
      {backLink}

      {/* Identity header */}
      <div className="card-animate card-surface p-6 sm:p-8 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl sm:text-3xl text-ink">{data.name || data.email || uid}</h1>
            <p className="text-ink-soft mt-1">{data.email}</p>
            <div className="flex flex-wrap items-center gap-2 mt-3">
              <span className="sticker !py-1 text-xs bg-paper-deep border-line text-ink-soft">{data.platform || 'unknown'}</span>
              <span className="sticker !py-1 text-xs bg-lake-tint border-lake/30 text-ink">{data.subscriptionStatus || 'unknown'}</span>
              <span className="sticker !py-1 text-xs bg-paper-deep border-line text-ink-soft">Joined {fmtDate(data.createdAt)}</span>
              <span className="sticker !py-1 text-xs bg-paper-deep border-line text-ink-soft">Last active {fmtDate(lastActiveAt)}</span>
            </div>
          </div>
          <div className="text-center shrink-0">
            {healthScore == null ? (
              <div className="font-mono text-5xl font-medium tabular-nums text-ink-faint">—</div>
            ) : (
              <div className={`font-mono text-5xl font-medium tabular-nums ${healthColor(healthScore)}`}>{healthScore}</div>
            )}
            <p className="text-xs font-mono text-ink-faint mt-1">HEALTH SCORE</p>
          </div>
        </div>
        {data.partialProfile && (
          <p className="text-sm text-ink-soft mt-4 pt-4 border-t border-line">
            No Firestore user record for this id — showing linked billing, email, and activity data only.
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Health factor breakdown */}
        <div className="card-animate card-surface p-6 sm:p-8">
          <h3 className="font-display text-xl text-ink mb-1">Health Factors</h3>
          <p className="text-sm font-mono text-ink-faint mb-5">Weighted 0–100 composite</p>
          {healthFactors ? (
            <div className="space-y-4">
              {FACTOR_META.map((f) => {
                const raw = healthFactors[f.key] ?? 0;
                const pct = Math.max(0, Math.min(100, raw));
                return (
                  <div key={f.key}>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className="text-ink-soft">{f.label} <span className="text-ink-faint font-mono">· {f.weight}%</span></span>
                      <span className="font-mono text-ink tabular-nums">{Math.round(raw)}</span>
                    </div>
                    <div className="h-2 rounded-full bg-paper-deep overflow-hidden">
                      <div className={`h-full rounded-full ${healthBg(raw)}`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="empty-state py-8">Factor breakdown unavailable</div>
          )}
        </div>

        {/* Usage */}
        <div className="card-animate card-surface p-6 sm:p-8">
          <h3 className="font-display text-xl text-ink mb-1">This Month&apos;s Usage</h3>
          <p className="text-sm font-mono text-ink-faint mb-5">Month to date · Firestore + Mixpanel</p>
          {!usageAvailable ? (
            <div className="empty-state py-8">Usage counts unavailable for this user</div>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                {usageItems.map((u) => {
                  const Icon = u.icon;
                  return (
                    <div key={u.label} className="rounded-chip bg-paper-deep border border-line p-4">
                      <Icon className="w-4 h-4 text-ink-faint mb-2" />
                      <div className="font-mono text-2xl text-ink tabular-nums">{u.value}</div>
                      <div className="text-xs text-ink-soft mt-0.5">{u.label}</div>
                    </div>
                  );
                })}
              </div>
              {firestoreUsageIncomplete && activityAvailable && (
                <p className="mt-4 text-xs font-mono text-ink-faint">
                  Some Firestore counters were unavailable; Mixpanel activity filled the gaps.
                </p>
              )}
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
        {/* Current subscription */}
        <div className="card-animate card-surface p-6 sm:p-8">
          <div className="flex items-center gap-2 mb-1">
            <BadgeCheck className="w-5 h-5 text-ink-faint" />
            <h3 className="font-display text-xl text-ink">Current Subscription</h3>
          </div>
          <p className="text-sm font-mono text-ink-faint mb-5">
            {sub?.source === 'revenuecat' ? 'Live from RevenueCat' : 'From user record'}
          </p>
          {!sub || sub.userExists === false ? (
            <div className="empty-state py-8">
              {sub?.userExists === false ? 'No RevenueCat customer for this id' : 'No subscription data'}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`sticker !py-1 text-xs ${subscriptionHasAccess ? 'bg-sage-tint border-sage/30 text-sage-deep' : 'bg-ember-tint border-ember/30 text-ember-deep'}`}>
                  {fmtLabel(sub.status) || (sub.isSubscribed ? 'active' : 'not subscribed')}
                </span>
                {sub.store && <span className="sticker !py-1 text-xs bg-paper-deep border-line text-ink-soft capitalize">{fmtLabel(sub.store)}</span>}
                {sub.isSandbox && <span className="sticker !py-1 text-xs bg-butter-tint border-butter/30 text-ink">sandbox</span>}
              </div>
              {sub.productId && (
                <p className="text-sm text-ink-soft">Product <span className="font-mono text-ink">{sub.productId}</span></p>
              )}
              {sub.currentPeriodEndsAt && (
                <p className="text-sm text-ink-soft">
                  {sub.willRenew === true ? 'Renews' : sub.willRenew === false ? 'Expires' : 'Period ends'} <span className="font-mono text-ink">{fmtDate(sub.currentPeriodEndsAt)}</span>
                </p>
              )}
              {sub.price != null && (
                <p className="text-sm text-ink-soft">Price <span className="font-mono text-ink">{sub.price} {sub.currency || ''}</span></p>
              )}
            </div>
          )}
        </div>

        {/* Mixpanel activity */}
        <ActivityCard
          activity={activity}
          isLoading={isActivityLoading}
          error={activityError}
        />
      </div>

      {/* Timelines */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
        {/* Subscription history */}
        <div className="card-animate card-surface p-6 sm:p-8">
          <div className="flex items-center gap-2 mb-1">
            <CreditCard className="w-5 h-5 text-ink-faint" />
            <h3 className="font-display text-xl text-ink">Subscription Timeline</h3>
          </div>
          <p className="text-sm font-mono text-ink-faint mb-5">
            {data.subscriptionHistorySource === 'events' ? 'RevenueCat events' : 'Derived from profile dates'}
          </p>
          {data.subscriptionHistory?.length ? (
            <ol className="space-y-3">
              {data.subscriptionHistory.map((s, i) => {
                const detail = [
                  fmtDate(s.date || s.timestamp),
                  fmtLabel(s.store) || s.platform,
                  s.price != null ? `${s.price} ${s.currency || ''}`.trim() : null,
                ].filter(Boolean).join(' · ');
                return (
                  <li key={i} className="flex items-start gap-3">
                    <span className="mt-1.5 w-2 h-2 rounded-full bg-lake shrink-0" />
                    <div>
                      <p className="text-sm text-ink capitalize">{fmtLabel(s.event || s.status) || 'Event'}</p>
                      <p className="text-xs font-mono text-ink-faint">{detail}</p>
                    </div>
                  </li>
                );
              })}
            </ol>
          ) : (
            <div className="empty-state py-8">No subscription events recorded</div>
          )}
        </div>

        {/* Email history */}
        <div className="card-animate card-surface p-6 sm:p-8">
          <div className="flex items-center gap-2 mb-5">
            <Mail className="w-5 h-5 text-ink-faint" />
            <h3 className="font-display text-xl text-ink">Email Engagement</h3>
          </div>
          {data.emailHistory?.length ? (
            <ol className="space-y-3">
              {data.emailHistory.map((e, i) => (
                <li key={i} className="flex items-start justify-between gap-3 border-b border-line pb-3 last:border-0">
                  <div>
                    <p className="text-sm text-ink">{(e.emailType || 'email').replace(/_/g, ' ')}</p>
                    <p className="text-xs font-mono text-ink-faint">{fmtDate(e.sentAt)}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {e.opened && <span className="sticker !py-0.5 !px-2 text-[0.7rem] bg-sage-tint border-sage/30 text-sage-deep">opened</span>}
                    {e.clicked && <span className="sticker !py-0.5 !px-2 text-[0.7rem] bg-lake-tint border-lake/30 text-ink">clicked</span>}
                    {e.converted && <span className="sticker !py-0.5 !px-2 text-[0.7rem] bg-ember-tint border-ember/30 text-ember-deep">converted</span>}
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <div className="empty-state py-8">No emails sent to this customer</div>
          )}
        </div>
      </div>
    </div>
  );
}
