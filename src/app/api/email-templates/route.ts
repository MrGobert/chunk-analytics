import { NextRequest, NextResponse } from 'next/server';

const ANALYTICS_API_URL = process.env.ANALYTICS_API_URL || 'https://cerebral-analytics-eff2e86d22c4.herokuapp.com';
const CEREBRAL_AUTH_TOKEN = process.env.CEREBRAL_AUTH_TOKEN || '';

export async function GET(request: NextRequest) {
  if (!CEREBRAL_AUTH_TOKEN) {
    return NextResponse.json({ error: 'CEREBRAL_AUTH_TOKEN not configured' }, { status: 500 });
  }

  try {
    const response = await fetch(`${ANALYTICS_API_URL}/api/analytics/email-templates`, {
      headers: {
        'Authorization': CEREBRAL_AUTH_TOKEN,
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
    });

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json({ error: `API error: ${response.status}` }, { status: response.status });
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Failed to fetch email templates:', error);
    return NextResponse.json({ error: 'Failed to fetch templates' }, { status: 500 });
  }
}
