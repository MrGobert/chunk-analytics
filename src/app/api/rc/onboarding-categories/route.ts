import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 60;

const ANALYTICS_API_URL = process.env.ANALYTICS_API_URL || 'https://cerebral-analytics-eff2e86d22c4.herokuapp.com';
const CEREBRAL_AUTH_TOKEN = process.env.CEREBRAL_AUTH_TOKEN || '';

export async function GET(request: NextRequest) {
  if (!CEREBRAL_AUTH_TOKEN) {
    console.error('CEREBRAL_AUTH_TOKEN not configured');
    return NextResponse.json(
      { error: 'CEREBRAL_AUTH_TOKEN not configured' },
      { status: 500 }
    );
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 55000);

  try {
    const response = await fetch(
      `${ANALYTICS_API_URL}/api/analytics/onboarding-categories`,
      {
        headers: {
          'Authorization': CEREBRAL_AUTH_TOKEN,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
        cache: 'no-store',
      }
    );

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Cerebral API error:', response.status, errorText);
      return NextResponse.json(
        { error: `Cerebral API returned ${response.status}: ${errorText}` },
        { status: response.status }
      );
    }

    const data = await response.json();

    const res = NextResponse.json({
      categories: data.categories ?? [],
      totalUsersWithCategories: data.totalUsersWithCategories ?? 0,
      totalUsers: data.totalUsers ?? 0,
      adoptionRate: data.adoptionRate ?? 0,
      lastUpdated: new Date().toISOString(),
      ...(data.note ? { note: data.note } : {}),
    });
    res.headers.set('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
    return res;
  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof Error && error.name === 'AbortError') {
      console.error('Cerebral API timeout for onboarding-categories');
    } else {
      console.error('Failed to fetch onboarding categories:', error);
    }

    return NextResponse.json({
      categories: [],
      totalUsersWithCategories: 0,
      totalUsers: 0,
      adoptionRate: 0,
      lastUpdated: new Date().toISOString(),
      note: `Data unavailable - ${error instanceof Error ? error.message : 'Unknown error'}`,
    });
  }
}
