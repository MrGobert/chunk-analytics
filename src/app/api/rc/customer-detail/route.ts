import { NextRequest } from 'next/server';
import { proxyCustomerDetail } from '@/lib/customer-detail-proxy';

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  return proxyCustomerDetail(request.nextUrl.searchParams.get('uid') || '');
}
