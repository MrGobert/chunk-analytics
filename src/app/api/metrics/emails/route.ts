import { NextRequest, NextResponse } from 'next/server';

const CEREBRAL_API_URL = process.env.CEREBRAL_API_URL || 'https://cerebral-12658c15cdb1.herokuapp.com';
const CEREBRAL_AUTH_TOKEN = process.env.CEREBRAL_AUTH_TOKEN || '';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const days = searchParams.get('days') || '30';

  try {
    const response = await fetch(
      `${CEREBRAL_API_URL}/webhooks/revenuecat/email-stats?days=${days}`,
      {
        headers: {
          'Authorization': CEREBRAL_AUTH_TOKEN,
          'Content-Type': 'application/json',
        },
        next: { revalidate: 300 }, // Cache for 5 minutes
      }
    );

    if (!response.ok) {
      console.error('Cerebral API error:', response.status, await response.text());
      return NextResponse.json(
        { error: 'Failed to fetch email stats' },
        { status: response.status }
      );
    }

    const data = await response.json();
    
    return NextResponse.json({
      ...data,
      lastUpdated: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Failed to fetch email stats:', error);
    return NextResponse.json(
      { error: 'Failed to fetch email stats' },
      { status: 500 }
    );
  }
}
