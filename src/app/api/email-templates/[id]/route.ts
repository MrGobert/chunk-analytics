import { NextRequest, NextResponse } from 'next/server';

const CEREBRAL_API_URL = process.env.CEREBRAL_API_URL || 'https://cerebral-12658c15cdb1.herokuapp.com';
const CEREBRAL_AUTH_TOKEN = process.env.CEREBRAL_AUTH_TOKEN || '';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!CEREBRAL_AUTH_TOKEN) {
    return NextResponse.json({ error: 'CEREBRAL_AUTH_TOKEN not configured' }, { status: 500 });
  }

  // Check if raw HTML preview is requested
  const { searchParams } = new URL(request.url);
  const format = searchParams.get('format');

  try {
    if (format === 'html') {
      // Return raw HTML for iframe rendering
      const response = await fetch(`${CEREBRAL_API_URL}/api/email-templates/preview/${id}`, {
        headers: {
          'Authorization': CEREBRAL_AUTH_TOKEN,
        },
        cache: 'no-store',
      });

      if (!response.ok) {
        return new NextResponse('Template not found', { status: 404 });
      }

      const html = await response.text();
      return new NextResponse(html, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    // Return JSON metadata + HTML
    const response = await fetch(`${CEREBRAL_API_URL}/api/email-templates/${id}`, {
      headers: {
        'Authorization': CEREBRAL_AUTH_TOKEN,
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
    });

    if (!response.ok) {
      return NextResponse.json({ error: `Template not found` }, { status: 404 });
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error(`Failed to fetch template ${id}:`, error);
    return NextResponse.json({ error: 'Failed to fetch template' }, { status: 500 });
  }
}
