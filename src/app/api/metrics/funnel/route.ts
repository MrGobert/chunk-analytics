import { NextRequest, NextResponse } from 'next/server';
import {
  fetchMixpanelEvents,
  filterByPlatform,
  filterByUserType,
  countEvents,
  filterEventsByType,
  getPropertyDistribution,
  getLastUpdated,
  UserType,
} from '@/lib/mixpanel';
import { getDateRange } from '@/lib/utils';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const range = searchParams.get('range') || '30d';
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const platform = searchParams.get('platform') || 'all';
    const userType = (searchParams.get('userType') || 'all') as UserType;

    const dateRange = from && to ? { from, to } : getDateRange(range);
    const allEvents = await fetchMixpanelEvents(dateRange.from, dateRange.to);
    const platformFilteredEvents = filterByPlatform(allEvents, platform);
    const events = filterByUserType(platformFilteredEvents, userType);

    // Funnel steps - support both old and new event names
    const paywallViewed = countEvents(events, 'Paywall Viewed') + 
                          countEvents(events, 'Paywall_Viewed') +
                          countEvents(events, 'Subscription View');
    const planSelected = countEvents(events, 'Plan Selected') + countEvents(events, 'Plan_Selected');
    const purchaseInitiated = countEvents(events, 'Purchase Initiated') + countEvents(events, 'Purchase_Initiated');
    const failedUserIds = new Set(
      events
        .filter((e) => e.event === 'Purchase Failed' || e.event === 'Purchase_Failed')
        .map((e) => e.properties.distinct_id)
    );
    const purchaseCompleted = events.filter(
      (e) => (e.event === 'Purchase Completed' || e.event === 'Purchase_Completed') &&
             !failedUserIds.has(e.properties.distinct_id)
    ).length;

    const funnel = [
      {
        name: 'Paywall Viewed',
        count: paywallViewed,
        percentage: 100,
        dropoff: 0,
      },
      {
        name: 'Plan Selected',
        count: planSelected,
        percentage: paywallViewed > 0 ? (planSelected / paywallViewed) * 100 : 0,
        dropoff: paywallViewed > 0 ? ((paywallViewed - planSelected) / paywallViewed) * 100 : 0,
      },
      {
        name: 'Purchase Initiated',
        count: purchaseInitiated,
        percentage: paywallViewed > 0 ? (purchaseInitiated / paywallViewed) * 100 : 0,
        dropoff: planSelected > 0 ? ((planSelected - purchaseInitiated) / planSelected) * 100 : 0,
      },
      {
        name: 'Purchase Completed',
        count: purchaseCompleted,
        percentage: paywallViewed > 0 ? (purchaseCompleted / paywallViewed) * 100 : 0,
        dropoff: purchaseInitiated > 0 ? ((purchaseInitiated - purchaseCompleted) / purchaseInitiated) * 100 : 0,
      },
    ];

    // Revenue by plan type - only count Purchase Completed events
    const completedPurchaseEvents = filterEventsByType(events, [
      'Purchase Completed', 'Purchase_Completed'
    ]);
    const planDistribution = getPropertyDistribution(completedPurchaseEvents, 'plan_type');
    const planPrices: Record<string, number> = {
      weekly: 2.99,
      monthly: 9.99,
      annual: 49.99,
      yearly: 49.99,
    };
    const revenueByPlan = Array.from(planDistribution.entries())
      .map(([plan, count]) => {
        // Use price from event properties when available, fall back to hardcoded
        const eventsForPlan = completedPurchaseEvents.filter(
          (e) => String(e.properties.plan_type) === plan
        );
        const avgPrice = eventsForPlan.length > 0
          ? eventsForPlan.reduce((sum, e) => sum + (Number(e.properties.price) || planPrices[plan.toLowerCase()] || 0), 0) / eventsForPlan.length
          : planPrices[plan.toLowerCase()] || 0;
        return {
          plan: plan || 'Unknown',
          count,
          revenue: count * avgPrice,
          estimated: eventsForPlan.some((e) => !e.properties.price),
        };
      })
      .sort((a, b) => b.revenue - a.revenue);

    // Trial conversion
    const trialUsers = events.filter((e) => e.properties.has_trial === true);
    const trialUserIds = new Set(trialUsers.map((e) => e.properties.distinct_id));
    const purchasedUsers = new Set(
      filterEventsByType(events, ['Purchase Completed', 'Purchase_Completed'])
        .filter((e) => !failedUserIds.has(e.properties.distinct_id))
        .map((e) => e.properties.distinct_id)
    );

    let converted = 0;
    trialUserIds.forEach((id) => {
      if (purchasedUsers.has(id)) converted++;
    });

    const trialConversion = {
      converted,
      notConverted: trialUserIds.size - converted,
    };

    // Failed purchases - support both old and new event names
    const failedEvents = filterEventsByType(events, ['Purchase Failed', 'Purchase_Failed']);
    const errorDistribution = getPropertyDistribution(failedEvents, 'error_message');
    const failedPurchases = Array.from(errorDistribution.entries())
      .map(([error, count]) => ({ error: error || 'Unknown Error', count }))
      .sort((a, b) => b.count - a.count);

    // Paywall sources - support both old and new event names
    const paywallEvents = filterEventsByType(events, ['Paywall Viewed', 'Paywall_Viewed', 'Subscription View']);
    const sourceDistribution = getPropertyDistribution(paywallEvents, 'source');
    const paywallSources = Array.from(sourceDistribution.entries())
      .map(([source, count]) => ({ source: source || 'Direct', count }))
      .sort((a, b) => b.count - a.count);

    // Additional paywall metrics
    const paywallDismissed = countEvents(events, 'Paywall Dismissed') + countEvents(events, 'Paywall_Dismissed');
    const purchaseCancelled = countEvents(events, 'Purchase Cancelled') + countEvents(events, 'Purchase_Cancelled');

    return NextResponse.json({
      funnel,
      revenueByPlan,
      trialConversion,
      failedPurchases,
      paywallSources,
      paywallDismissed,
      purchaseCancelled,
      dateRange,
      platform,
      userType,
      lastUpdated: getLastUpdated(),
    });
  } catch (error) {
    console.error('Error fetching funnel metrics:', error);
    return NextResponse.json(
      { error: 'Failed to fetch funnel metrics' },
      { status: 500 }
    );
  }
}
