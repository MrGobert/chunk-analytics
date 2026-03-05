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
      `${ANALYTICS_API_URL}/api/analytics/customer-health`,
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
      distribution: data.distribution ?? { healthy: 0, atRisk: 0, churning: 0 },
      customers: data.customers ?? [],
      averageHealthScore: data.averageHealthScore ?? 0,
      lastUpdated: new Date().toISOString(),
    });
  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof Error && error.name === 'AbortError') {
      console.error('Cerebral API timeout for customer-health');
      return NextResponse.json({
        distribution: { healthy: 0, atRisk: 0, churning: 0 },
        customers: [], averageHealthScore: 0,
        lastUpdated: new Date().toISOString(),
        note: 'Data unavailable - Cerebral server timeout. Try refreshing.',
      });
    }

    console.error('Failed to fetch customer health:', error);
    return NextResponse.json({
      distribution: { healthy: 0, atRisk: 0, churning: 0 },
      customers: [], averageHealthScore: 0,
      lastUpdated: new Date().toISOString(),
      note: `Data unavailable - ${error instanceof Error ? error.message : 'Unknown error'}`,
    });
  }
}
