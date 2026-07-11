// Connections — the in-chat "Connections" sidebar (grounded "Used in answer" +
// related "From your Chunk" items, pinning, @-mentions, ambient recall, and the
// collection/note/inbox card actions). All Connections_* events are client-side
// and fire on BOTH web (chunk-web) and Apple (semantic) with identical raw
// names, so this route rolls the two platforms up together. NOTE: distinct from
// the "Connectors" feature (Connector_*/Notion_*/Gamma_* OAuth integrations) —
// do not conflate them.
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import {
  fetchMixpanelEventsFiltered,
  filterByPlatform,
  getLastUpdated,
  normalizeEventName,
  platformOf,
} from '@/lib/mixpanel';
import { getDateRange, formatDate } from '@/lib/utils';
import { buildFunnel } from '@/lib/funnel';

const CONNECTION_EVENTS = [
  'Connections_Preview_Opened',
  'Connections_Pin_Toggled',
  'Connections_Action_Used',
  'Connections_References_Sent',
  'Connections_Collection_Created',
  'Connections_Mention_Used',
  'Connections_Recall_Shown',
  'Connections_Recall_Accepted',
  'Connections_Recall_Dismissed',
];

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const range = searchParams.get('range') || '30d';
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const platform = searchParams.get('platform') || 'all';

    const dateRange = from && to ? { from, to } : getDateRange(range);
    const raw = await fetchMixpanelEventsFiltered(
      dateRange.from,
      dateRange.to,
      CONNECTION_EVENTS,
    );
    const events = filterByPlatform(raw, platform);

    const actionMix = new Map<string, number>();
    const objectTypeMix = new Map<string, number>();
    const byPlatform = new Map<string, number>();
    const daily = new Map<string, { engagements: number; previews: number }>();
    const users = new Set<string>();

    let itemsPreviewed = 0;
    let pinsToggled = 0;
    let pinsAdded = 0;
    let pinsRemoved = 0;
    let actionsUsed = 0;
    let mentionsUsed = 0;
    let referencesSentEvents = 0;
    let referencesSentItems = 0;
    let collectionsCreated = 0;
    let collectionItems = 0;
    let collectionsWithConversation = 0;
    let recallShown = 0;
    let recallAccepted = 0;
    let recallDismissed = 0;
    let recallItemsShown = 0;
    let recallItemsAccepted = 0;

    const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) || 0) + 1);
    const dayOf = (t: number) => formatDate(new Date(t * 1000));
    const ensureDay = (d: string) => {
      if (!daily.has(d)) daily.set(d, { engagements: 0, previews: 0 });
      return daily.get(d)!;
    };

    for (const e of events) {
      const t = e.properties.time as number;
      const p = e.properties as Record<string, unknown>;
      const day = ensureDay(dayOf(t));
      const objectType = String(p.object_type ?? 'unknown');
      const uid = p.distinct_id ? String(p.distinct_id) : '';
      // A genuine-usage engagement counts toward unique users + the daily line.
      const engage = () => {
        day.engagements++;
        if (uid) users.add(uid);
        bump(byPlatform, platformOf(e));
      };

      switch (normalizeEventName(e.event)) {
        case 'Connections_Preview_Opened':
          itemsPreviewed++;
          bump(objectTypeMix, objectType);
          day.previews++;
          break;
        case 'Connections_Pin_Toggled':
          pinsToggled++;
          if (p.pinned === true) pinsAdded++;
          else pinsRemoved++;
          bump(objectTypeMix, objectType);
          engage();
          break;
        case 'Connections_Action_Used':
          actionsUsed++;
          bump(actionMix, String(p.action ?? 'unknown'));
          bump(objectTypeMix, objectType);
          engage();
          break;
        case 'Connections_Mention_Used':
          mentionsUsed++;
          bump(objectTypeMix, objectType);
          engage();
          break;
        case 'Connections_References_Sent':
          referencesSentEvents++;
          referencesSentItems += Number(p.item_count ?? 0);
          engage();
          break;
        case 'Connections_Collection_Created':
          collectionsCreated++;
          collectionItems += Number(p.item_count ?? 0);
          if (p.with_conversation === true) collectionsWithConversation++;
          engage();
          break;
        case 'Connections_Recall_Shown':
          recallShown++;
          recallItemsShown += Number(p.item_count ?? 0);
          break;
        case 'Connections_Recall_Accepted':
          recallAccepted++;
          recallItemsAccepted += Number(p.item_count ?? 0);
          engage();
          break;
        case 'Connections_Recall_Dismissed':
          recallDismissed++;
          break;
      }
    }

    const toArr = (m: Map<string, number>) =>
      Array.from(m)
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value);

    const recallAcceptRate = recallShown > 0 ? recallAccepted / recallShown : 0;

    const pinOutcomes = [
      { name: 'Pinned', value: pinsAdded },
      { name: 'Unpinned', value: pinsRemoved },
    ].filter((o) => o.value > 0);

    const recallFunnel = buildFunnel([
      { name: 'Recall Shown', count: recallShown },
      { name: 'Recall Accepted', count: recallAccepted },
    ]);

    const dailyTrend = Array.from(daily)
      .map(([date, o]) => ({ date, engagements: o.engagements, previews: o.previews }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return NextResponse.json(
      {
        itemsPreviewed,
        pinsToggled,
        pinsAdded,
        pinsRemoved,
        actionsUsed,
        mentionsUsed,
        referencesSentEvents,
        referencesSentItems,
        collectionsCreated,
        collectionItems,
        collectionsWithConversation,
        recallShown,
        recallAccepted,
        recallDismissed,
        recallItemsShown,
        recallItemsAccepted,
        recallAcceptRate,
        uniqueUsers: users.size,
        actionMix: toArr(actionMix),
        objectTypeMix: toArr(objectTypeMix),
        pinOutcomes,
        connectionsByPlatform: toArr(byPlatform),
        recallFunnel,
        dailyTrend,
        dateRange,
        lastUpdated: getLastUpdated(),
      },
      { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' } },
    );
  } catch (error) {
    console.error('Error fetching connections metrics:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch connections metrics',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
