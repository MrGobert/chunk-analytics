import { NextResponse } from 'next/server';

export const maxDuration = 60;

const ANALYTICS_API_URL = process.env.ANALYTICS_API_URL || 'https://cerebral-analytics-eff2e86d22c4.herokuapp.com';
const CEREBRAL_AUTH_TOKEN = process.env.CEREBRAL_AUTH_TOKEN || '';

export async function POST() {
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
    const response = await fetch(`${ANALYTICS_API_URL}/api/analytics/evals/run`, {
      method: 'POST',
      headers: {
        'Authorization': CEREBRAL_AUTH_TOKEN,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
      cache: 'no-store',
    });

    clearTimeout(timeoutId);

    // 409 (run already in progress) is passed through with its active run_id
    // so the client can attach to the in-flight run instead of erroring.
    const data = await response.json().catch(() => ({}));
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    clearTimeout(timeoutId);
    console.error('Failed to start eval run:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to start eval run' },
      { status: 502 }
    );
  }
}
