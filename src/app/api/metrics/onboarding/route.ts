import { NextRequest, NextResponse } from 'next/server';
import {
  fetchMixpanelEvents,
  filterByUserType,
  getLastUpdated,
  UserType,
} from '@/lib/mixpanel';
import { getDateRange, getDaysInRange } from '@/lib/utils';

// Platform groupings
type PlatformGroup = 'mobile' | 'macOS' | 'web';

function getPlatformGroup(event: { properties: Record<string, unknown> }): PlatformGroup | null {
  const props = event.properties;
  const os = props.$os as string | undefined;
  const mpLib = props.mp_lib as string | undefined;
  const platform = props.platform as string | undefined;

  // Web
  if (mpLib === 'web' || platform === 'web') return 'web';
  // macOS
  if (os === 'macOS' || platform === 'macOS') return 'macOS';
  // Mobile (iOS, iPadOS, visionOS)
  if (os === 'iOS' || os === 'iPadOS' || os === 'visionOS' ||
      platform === 'iOS' || platform === 'visionOS') return 'mobile';

  return null;
}

const SIGNUP_EVENTS = ['SignUp', 'Signup_Completed', 'Account Created'];
const PURCHASE_COMPLETED_EVENTS = ['Purchase Completed', 'Purchase_Completed'];

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const range = searchParams.get('range') || '30d';
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const platformGroup = searchParams.get('platform') || 'mobile';
    const userType = (searchParams.get('userType') || 'all') as UserType;

    const dateRange = from && to ? { from, to } : getDateRange(range);
    const allEvents = await fetchMixpanelEvents(dateRange.from, dateRange.to);
    const events = filterByUserType(allEvents, userType);
    const days = getDaysInRange(dateRange.from, dateRange.to);

    // Filter events to the selected platform group
    const platformEvents = events.filter((e) => getPlatformGroup(e) === platformGroup);

    // Helper: unique user IDs from matching events
    const uniqueUsersFor = (evts: typeof platformEvents, eventNames: string[]) =>
      new Set(evts.filter((e) => eventNames.includes(e.event)).map((e) => e.properties.distinct_id));

    let funnel: { name: string; count: number; percentage: number; dropoff: number }[];
    let funnelLabel: string;

    if (platformGroup === 'web') {
      // Web funnel: Site Visit → Sign Up CTA → Account Created → Subscribed
      const visitors = new Set(platformEvents.map((e) => e.properties.distinct_id));

      // Users who viewed the signup/auth page or clicked a signup CTA
      // Proxy: users who visited and then had a signup-related page view or action
      const signupPageUsers = new Set(
        platformEvents
          .filter((e) => {
            if (e.event === 'Page_Viewed') {
              const page = String(e.properties.page || e.properties.$current_url || '').toLowerCase();
              return page.includes('sign') || page.includes('register') || page.includes('auth') || page.includes('try');
            }
            return false;
          })
          .map((e) => e.properties.distinct_id)
      );

      const accountCreated = uniqueUsersFor(platformEvents, SIGNUP_EVENTS);
      const subscribed = uniqueUsersFor(platformEvents, PURCHASE_COMPLETED_EVENTS);

      const steps = [
        { name: 'Site Visitors', count: visitors.size },
        { name: 'Viewed Sign Up', count: signupPageUsers.size },
        { name: 'Account Created', count: accountCreated.size },
        { name: 'Subscribed', count: subscribed.size },
      ];

      funnel = buildFunnel(steps);
      funnelLabel = 'Web: Marketing site to subscription';

    } else if (platformGroup === 'macOS') {
      // macOS funnel: First Open → Signed Up → Subscribed (no onboarding screens)
      const firstOpen = uniqueUsersFor(platformEvents, ['$ae_first_open']);
      const signedUp = uniqueUsersFor(platformEvents, SIGNUP_EVENTS);
      const subscribed = uniqueUsersFor(platformEvents, PURCHASE_COMPLETED_EVENTS);

      const steps = [
        { name: 'First Open', count: firstOpen.size },
        { name: 'Signed Up', count: signedUp.size },
        { name: 'Subscribed', count: subscribed.size },
      ];

      funnel = buildFunnel(steps);
      funnelLabel = 'macOS: First open to subscription (no onboarding)';

    } else {
      // Mobile funnel (iOS/iPadOS/visionOS): First Open → Started Onboarding → Signed Up → Subscribed
      const firstOpen = uniqueUsersFor(platformEvents, ['$ae_first_open']);
      const onboarding = uniqueUsersFor(platformEvents, ['Onboarding']);
      const signedUp = uniqueUsersFor(platformEvents, SIGNUP_EVENTS);
      const subscribed = uniqueUsersFor(platformEvents, PURCHASE_COMPLETED_EVENTS);

      const steps = [
        { name: 'First Open', count: firstOpen.size },
        { name: 'Started Onboarding', count: onboarding.size },
        { name: 'Signed Up', count: signedUp.size },
        { name: 'Subscribed', count: subscribed.size },
      ];

      funnel = buildFunnel(steps);
      funnelLabel = 'Mobile: First open to subscription';
    }

    // Daily signup activity (for the selected platform)
    const signupsOverTime = days.map((date) => {
      const daySignups = new Set(
        platformEvents
          .filter((e) => {
            if (!SIGNUP_EVENTS.includes(e.event)) return false;
            const eventDate = new Date(e.properties.time * 1000).toISOString().split('T')[0];
            return eventDate === date;
          })
          .map((e) => e.properties.distinct_id)
      );
      return { date, count: daySignups.size };
    });

    // First open to signup timing (mobile/macOS only)
    let firstOpenToSignup: { day: string; count: number }[] = [];
    if (platformGroup !== 'web') {
      const userFirstOpen = new Map<string, number>();
      platformEvents
        .filter((e) => e.event === '$ae_first_open')
        .forEach((e) => {
          const userId = e.properties.distinct_id;
          const time = e.properties.time;
          if (!userFirstOpen.has(userId) || time < userFirstOpen.get(userId)!) {
            userFirstOpen.set(userId, time);
          }
        });

      // For each user's first signup event, compute days since first open
      const userSignupTime = new Map<string, number>();
      platformEvents
        .filter((e) => SIGNUP_EVENTS.includes(e.event))
        .forEach((e) => {
          const userId = e.properties.distinct_id;
          const time = e.properties.time;
          if (!userSignupTime.has(userId) || time < userSignupTime.get(userId)!) {
            userSignupTime.set(userId, time);
          }
        });

      const timeDiffs: number[] = [];
      userSignupTime.forEach((signupTime, userId) => {
        const openTime = userFirstOpen.get(userId);
        if (openTime !== undefined) {
          const diffDays = Math.floor((signupTime - openTime) / 86400);
          if (diffDays >= 0) timeDiffs.push(diffDays);
        }
      });

      firstOpenToSignup = [
        { day: 'Same day', count: timeDiffs.filter((d) => d === 0).length },
        { day: 'Day 1', count: timeDiffs.filter((d) => d === 1).length },
        { day: 'Day 2-3', count: timeDiffs.filter((d) => d >= 2 && d <= 3).length },
        { day: 'Day 4-7', count: timeDiffs.filter((d) => d >= 4 && d <= 7).length },
        { day: 'Day 8+', count: timeDiffs.filter((d) => d > 7).length },
      ];
    }

    // Summary stats
    const totalFirstStep = funnel[0]?.count || 0;
    const totalSignups = funnel.find((s) => s.name === 'Signed Up' || s.name === 'Account Created')?.count || 0;
    const conversionRate = totalFirstStep > 0 ? totalSignups / totalFirstStep : 0;

    return NextResponse.json({
      funnel,
      funnelLabel,
      signupsOverTime,
      firstOpenToSignup,
      totalFirstStep,
      totalSignups,
      conversionRate,
      dateRange,
      platform: platformGroup,
      userType,
      lastUpdated: getLastUpdated(),
    });
  } catch (error) {
    console.error('Error fetching onboarding metrics:', error);
    return NextResponse.json(
      { error: 'Failed to fetch onboarding metrics', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

function buildFunnel(steps: { name: string; count: number }[]) {
  const base = steps[0]?.count || 0;
  return steps.map((step, i) => {
    const prevCount = i > 0 ? steps[i - 1].count : step.count;
    return {
      name: step.name,
      count: step.count,
      percentage: base > 0 ? (step.count / base) * 100 : (i === 0 ? 100 : 0),
      dropoff: i === 0 ? 0 : (prevCount > 0 ? Math.max(0, ((prevCount - step.count) / prevCount) * 100) : 0),
    };
  });
}
