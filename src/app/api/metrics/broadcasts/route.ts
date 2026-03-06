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
      `${ANALYTICS_API_URL}/api/analytics/broadcasts`,
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

    return NextResponse.json({
      broadcasts: data.broadcasts ?? [],
      totals: {
        sent: data.totals?.sent ?? 0,
        draft: data.totals?.draft ?? 0,
        queued: data.totals?.queued ?? 0,
      },
      lastUpdated: new Date().toISOString(),
    });
  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof Error && error.name === 'AbortError') {
      console.error('Cerebral API timeout for broadcasts');
    } else {
      console.error('Failed to fetch broadcasts:', error);
    }

    return NextResponse.json({
      broadcasts: [],
      totals: { sent: 0, draft: 0, queued: 0 },
      lastUpdated: new Date().toISOString(),
      note: `Broadcast data unavailable - ${error instanceof Error ? error.message : 'Unknown error'}`,
    });
  }
}
