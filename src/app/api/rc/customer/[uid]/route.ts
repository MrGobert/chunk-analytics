import type { NextRequest } from 'next/server';
import { proxyCustomerDetail } from '@/lib/customer-detail-proxy';

export const maxDuration = 60;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ uid: string }> }
) {
  const { uid } = await params;
  return proxyCustomerDetail(uid);
}
