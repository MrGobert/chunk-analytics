import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 60;

const ANALYTICS_API_URL = process.env.ANALYTICS_API_URL || 'https://cerebral-analytics-eff2e86d22c4.herokuapp.com';
const CEREBRAL_AUTH_TOKEN = process.env.CEREBRAL_AUTH_TOKEN || '';

const EMPTY_RESPONSE = {
  churnRate: 0, churnRateTrend: [], atRiskUsers: [], churnedUsers: [],
  winbackEffectiveness: {}, churnReasons: {},
  avgTenureBeforeChurn: 0, atRiskCount: 0, winbackRate: 0,
  topEngagedUsers: [], engagedCount: 0,
};

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const days = searchParams.get('days') || '90';

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
      `${ANALYTICS_API_URL}/api/analytics/churn-intelligence?days=${days}`,
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
      churnRate: data.churnRate ?? 0,
      churnRateTrend: data.churnRateTrend ?? [],
      atRiskUsers: data.atRiskUsers ?? [],
      churnedUsers: data.churnedUsers ?? [],
      winbackEffectiveness: data.winbackEffectiveness ?? {},
      churnReasons: data.churnReasons ?? {},
      avgTenureBeforeChurn: data.avgTenureBeforeChurn ?? 0,
      atRiskCount: data.atRiskCount ?? 0,
      winbackRate: data.winbackRate ?? 0,
      topEngagedUsers: data.topEngagedUsers ?? [],
      engagedCount: data.engagedCount ?? 0,
      lastUpdated: new Date().toISOString(),
      ...(data.note ? { note: data.note } : {}),
    });
  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof Error && error.name === 'AbortError') {
      console.error('Cerebral API timeout for churn-intelligence');
      return NextResponse.json({
        ...EMPTY_RESPONSE,
        lastUpdated: new Date().toISOString(),
        dataUnavailable: true,
        note: 'Data unavailable - Cerebral server timeout. Try refreshing.',
      }, { status: 504 });
    }

    console.error('Failed to fetch churn intelligence:', error);
    return NextResponse.json({
      ...EMPTY_RESPONSE,
      lastUpdated: new Date().toISOString(),
      dataUnavailable: true,
      note: `Data unavailable - ${error instanceof Error ? error.message : 'Unknown error'}`,
    }, { status: 502 });
  }
}
