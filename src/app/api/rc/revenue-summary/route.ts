import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 60;

const CEREBRAL_API_URL = process.env.CEREBRAL_API_URL || 'https://cerebral-12658c15cdb1.herokuapp.com';
const CEREBRAL_AUTH_TOKEN = process.env.CEREBRAL_AUTH_TOKEN || '';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const days = searchParams.get('days') || '30';

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
      `${CEREBRAL_API_URL}/api/analytics/revenue-summary?days=${days}`,
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
      mrr: data.mrr ?? 0,
      mrrChange: data.mrrChange ?? 0,
      arr: data.arr ?? 0,
      todayRevenue: data.todayRevenue ?? 0,
      totalSubscribers: data.totalSubscribers ?? 0,
      trialUsers: data.trialUsers ?? 0,
      churnRate: data.churnRate ?? 0,
      byPlatform: data.byPlatform ?? {},
      byProduct: data.byProduct ?? {},
      mrrTrend: data.mrrTrend ?? [],
      newSubscribers: data.newSubscribers ?? 0,
      churned: data.churned ?? 0,
      netNew: data.netNew ?? 0,
      lastUpdated: new Date().toISOString(),
      ...(data.note ? { note: data.note } : {}),
    });
  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof Error && error.name === 'AbortError') {
      console.error('Cerebral API timeout for revenue-summary');
      return NextResponse.json({
        mrr: 0, mrrChange: 0, arr: 0, todayRevenue: 0,
        totalSubscribers: 0, trialUsers: 0, churnRate: 0,
        byPlatform: {}, byProduct: {}, mrrTrend: [],
        newSubscribers: 0, churned: 0, netNew: 0,
        lastUpdated: new Date().toISOString(),
        note: 'Data unavailable - Cerebral server timeout. Try refreshing.',
      });
    }

    console.error('Failed to fetch revenue summary:', error);
    return NextResponse.json({
      mrr: 0, mrrChange: 0, arr: 0, todayRevenue: 0,
      totalSubscribers: 0, trialUsers: 0, churnRate: 0,
      byPlatform: {}, byProduct: {}, mrrTrend: [],
      newSubscribers: 0, churned: 0, netNew: 0,
      lastUpdated: new Date().toISOString(),
      note: `Data unavailable - ${error instanceof Error ? error.message : 'Unknown error'}`,
    });
  }
}
