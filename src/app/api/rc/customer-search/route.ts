import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const ANALYTICS_API_URL =
  process.env.ANALYTICS_API_URL ||
  'https://cerebral-analytics-eff2e86d22c4.herokuapp.com';
const CEREBRAL_AUTH_TOKEN = process.env.CEREBRAL_AUTH_TOKEN || '';

interface UpstreamError {
  error?: unknown;
}

function errorMessage(payload: unknown, fallback: string) {
  if (
    payload &&
    typeof payload === 'object' &&
    'error' in payload &&
    typeof (payload as UpstreamError).error === 'string'
  ) {
    return (payload as UpstreamError).error as string;
  }
  return fallback;
}

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get('q')?.trim() ?? '';

  if (!query) {
    return NextResponse.json(
      { error: 'Customer UID or email address is required' },
      { status: 400 },
    );
  }

  if (!CEREBRAL_AUTH_TOKEN) {
    console.error('CEREBRAL_AUTH_TOKEN not configured');
    return NextResponse.json(
      { error: 'CEREBRAL_AUTH_TOKEN not configured' },
      { status: 500 },
    );
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 55_000);

  try {
    const response = await fetch(
      `${ANALYTICS_API_URL}/api/analytics/customer-search?q=${encodeURIComponent(query)}`,
      {
        headers: {
          Authorization: CEREBRAL_AUTH_TOKEN,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
        cache: 'no-store',
      },
    );

    const payload: unknown = await response.json().catch(() => null);

    if (!response.ok) {
      const fallback =
        response.status === 404
          ? 'No customer found for that UID or email address'
          : `Cerebral API returned ${response.status}`;
      return NextResponse.json(
        { error: errorMessage(payload, fallback) },
        { status: response.status },
      );
    }

    if (
      !payload ||
      typeof payload !== 'object' ||
      !('uid' in payload) ||
      typeof payload.uid !== 'string' ||
      !payload.uid.trim()
    ) {
      console.error('Cerebral customer search response did not include a UID');
      return NextResponse.json(
        { error: 'Customer lookup returned an invalid response' },
        { status: 502 },
      );
    }

    const result: { uid: string; email?: string; name?: string } = {
      uid: payload.uid.trim(),
    };
    if ('email' in payload && typeof payload.email === 'string') {
      result.email = payload.email;
    }
    if ('name' in payload && typeof payload.name === 'string') {
      result.name = payload.name;
    }

    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      console.error('Cerebral API timeout for customer search');
      return NextResponse.json(
        { error: 'Customer lookup timed out. Please try again.' },
        { status: 504 },
      );
    }

    console.error('Failed to search for customer:', error);
    return NextResponse.json(
      { error: 'Customer lookup failed. Please try again.' },
      { status: 502 },
    );
  } finally {
    clearTimeout(timeoutId);
  }
}
