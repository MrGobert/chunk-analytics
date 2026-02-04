import { NextRequest, NextResponse } from 'next/server';

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
  const timeoutId = setTimeout(() => controller.abort(), 25000); // 25s timeout

  try {
    console.log(`Fetching email stats from ${CEREBRAL_API_URL}/webhooks/revenuecat/email-stats?days=${days}`);
    
    const response = await fetch(
      `${CEREBRAL_API_URL}/webhooks/revenuecat/email-stats?days=${days}`,
      {
        headers: {
          'Authorization': CEREBRAL_AUTH_TOKEN,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
        cache: 'no-store', // Don't cache at edge, we handle it ourselves
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
    
    // Ensure all expected fields exist with defaults
    const safeData = {
      period_days: data.period_days ?? 30,
      generated_at: data.generated_at ?? new Date().toISOString(),
      by_email_type: data.by_email_type ?? {},
      totals: {
        sent: data.totals?.sent ?? 0,
        converted: data.totals?.converted ?? 0,
        overallConversionRate: data.totals?.overallConversionRate ?? 0,
      },
      lastUpdated: new Date().toISOString(),
    };
    
    return NextResponse.json(safeData);
  } catch (error) {
    clearTimeout(timeoutId);
    
    if (error instanceof Error && error.name === 'AbortError') {
      console.error('Cerebral API timeout');
      // Return empty data on timeout so page renders with zeros instead of error
      return NextResponse.json({
        period_days: parseInt(days) || 30,
        generated_at: new Date().toISOString(),
        by_email_type: {},
        totals: {
          sent: 0,
          converted: 0,
          overallConversionRate: 0,
        },
        lastUpdated: new Date().toISOString(),
        note: 'Data unavailable - Cerebral server timeout. Try refreshing.',
      });
    }
    
    console.error('Failed to fetch email stats:', error);
    // Return empty data on error so page renders with zeros instead of crashing
    return NextResponse.json({
      period_days: parseInt(days) || 30,
      generated_at: new Date().toISOString(),
      by_email_type: {},
      totals: {
        sent: 0,
        converted: 0,
        overallConversionRate: 0,
      },
      lastUpdated: new Date().toISOString(),
      note: `Data unavailable - ${error instanceof Error ? error.message : 'Unknown error'}`,
    });
  }
}
