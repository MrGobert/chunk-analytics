import CustomerDetailPage from '@/components/customers/CustomerDetailPage';

export default async function CustomerDetailQueryRoute({
  searchParams,
}: {
  searchParams: Promise<{ uid?: string | string[] }>;
}) {
  const { uid: rawUid } = await searchParams;
  const uid = Array.isArray(rawUid) ? rawUid[0] || '' : rawUid || '';
  return <CustomerDetailPage uid={uid} />;
}
