import { NextRequest, NextResponse } from 'next/server';
import {
  fetchMixpanelEvents,
  filterByPlatform,
  filterByUserType,
  calculateTrend,
  getLastUpdated,
  UserType,
} from '@/lib/mixpanel';
import { getDateRange, getDaysInRange } from '@/lib/utils';

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
    const platformFiltered = filterByPlatform(allEvents, platform);
    const events = filterByUserType(platformFiltered, userType);

    // Funnel step 1: Marketing Visit — unique users with Marketing_Session_Started
    const marketingUsers = new Set(
      events
        .filter((e) => e.event === 'Marketing_Session_Started')
        .map((e) => e.properties.distinct_id)
    );

    // Funnel step 2: Guest Trial — unique users with App_Session_Started where user_type='guest', OR Guest_Activity
    const guestUsers = new Set(
      events
        .filter(
          (e) =>
            (e.event === 'App_Session_Started' && e.properties.user_type === 'guest') ||
            e.event === 'Guest_Activity'
        )
        .map((e) => e.properties.distinct_id)
    );

    // Funnel step 3: Account Created — unique users with Signup_Completed
    const signupUsers = new Set(
      events
        .filter((e) => e.event === 'Signup_Completed')
        .map((e) => e.properties.distinct_id)
    );

    // Funnel step 4: Subscriber — unique users with Purchase_Completed
    const subscriberUsers = new Set(
      events
        .filter((e) => e.event === 'Purchase_Completed')
        .map((e) => e.properties.distinct_id)
    );

    const steps = [
      { name: 'Marketing Visit', count: marketingUsers.size },
      { name: 'Guest Trial', count: guestUsers.size },
      { name: 'Account Created', count: signupUsers.size },
      { name: 'Subscriber', count: subscriberUsers.size },
    ];

    const topCount = steps[0].count || 1;
    const funnel = steps.map((step, i) => ({
      name: step.name,
      count: step.count,
      percentage: Math.round((step.count / topCount) * 100 * 10) / 10,
      dropoff: i === 0 ? 0 : Math.round(((steps[i - 1].count - step.count) / (steps[i - 1].count || 1)) * 100 * 10) / 10,
    }));

    // Conversion rates
    const safeDiv = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100 * 10) / 10 : 0);
    const conversionRates = {
      marketingToGuest: safeDiv(guestUsers.size, marketingUsers.size),
      guestToSignup: safeDiv(signupUsers.size, guestUsers.size),
      signupToSubscriber: safeDiv(subscriberUsers.size, signupUsers.size),
      overallMarketingToSubscriber: safeDiv(subscriberUsers.size, marketingUsers.size),
    };

    // Daily data
    const days = getDaysInRange(dateRange.from, dateRange.to);
    const dailyData = days.map((date) => {
      const dayEvents = events.filter((e) => {
        const eventDate = new Date(e.properties.time * 1000).toISOString().split('T')[0];
        return eventDate === date;
      });

      return {
        date,
        marketing: new Set(dayEvents.filter((e) => e.event === 'Marketing_Session_Started').map((e) => e.properties.distinct_id)).size,
        guest: new Set(dayEvents.filter((e) => (e.event === 'App_Session_Started' && e.properties.user_type === 'guest') || e.event === 'Guest_Activity').map((e) => e.properties.distinct_id)).size,
        signup: new Set(dayEvents.filter((e) => e.event === 'Signup_Completed').map((e) => e.properties.distinct_id)).size,
        subscriber: new Set(dayEvents.filter((e) => e.event === 'Purchase_Completed').map((e) => e.properties.distinct_id)).size,
      };
    });

    return NextResponse.json({
      funnel,
      dailyData,
      conversionRates,
      lastUpdated: getLastUpdated(),
    }, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
      },
    });
  } catch (error) {
    console.error('Error fetching acquisition metrics:', error);
    return NextResponse.json(
      { error: 'Failed to fetch acquisition metrics', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
