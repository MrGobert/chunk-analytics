import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 60;

const ANALYTICS_API_URL = process.env.ANALYTICS_API_URL || 'https://cerebral-analytics-eff2e86d22c4.herokuapp.com';
const CEREBRAL_AUTH_TOKEN = process.env.CEREBRAL_AUTH_TOKEN || '';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  const { runId } = await params;

  if (!CEREBRAL_AUTH_TOKEN) {
    console.error('CEREBRAL_AUTH_TOKEN not configured');
    return NextResponse.json(
      { error: 'CEREBRAL_AUTH_TOKEN not configured' },
      { status: 500 }
    );
  }

  if (!runId) {
    return NextResponse.json({ error: 'runId is required' }, { status: 400 });
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 55000);

  try {
    const response = await fetch(
      `${ANALYTICS_API_URL}/api/analytics/evals/runs/${encodeURIComponent(runId)}`,
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

    const data = await response.json().catch(() => ({}));
    return NextResponse.json(
      { ...data, lastUpdated: new Date().toISOString() },
      { status: response.status }
    );
  } catch (error) {
    clearTimeout(timeoutId);
    console.error('Failed to fetch eval run detail:', error);
    return NextResponse.json(
      {
        run: null,
        lastUpdated: new Date().toISOString(),
        note: `Data unavailable - ${error instanceof Error ? error.message : 'Unknown error'}`,
      },
      { status: 502 }
    );
  }
}
