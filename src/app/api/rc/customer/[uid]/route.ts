import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 60;

const CEREBRAL_API_URL = process.env.CEREBRAL_API_URL || 'https://cerebral-12658c15cdb1.herokuapp.com';
const CEREBRAL_AUTH_TOKEN = process.env.CEREBRAL_AUTH_TOKEN || '';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ uid: string }> }
) {
  const { uid } = await params;

  if (!CEREBRAL_AUTH_TOKEN) {
    console.error('CEREBRAL_AUTH_TOKEN not configured');
    return NextResponse.json(
      { error: 'CEREBRAL_AUTH_TOKEN not configured' },
      { status: 500 }
    );
  }

  if (!uid) {
    return NextResponse.json(
      { error: 'Customer UID is required' },
      { status: 400 }
    );
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 55000);

  try {
    const response = await fetch(
      `${CEREBRAL_API_URL}/api/analytics/customer/${encodeURIComponent(uid)}`,
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
      ...data,
      lastUpdated: new Date().toISOString(),
    });
  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof Error && error.name === 'AbortError') {
      console.error('Cerebral API timeout for customer detail');
      return NextResponse.json(
        { error: 'Request timeout - try again' },
        { status: 504 }
      );
    }

    console.error('Failed to fetch customer:', error);
    return NextResponse.json(
      { error: `Failed to fetch customer: ${error instanceof Error ? error.message : 'Unknown error'}` },
      { status: 500 }
    );
  }
}
