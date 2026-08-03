import CustomerDetailPage from '@/components/customers/CustomerDetailPage';

export default async function LegacyCustomerDetailRoute({
  params,
}: {
  params: Promise<{ uid: string }>;
}) {
  const { uid } = await params;
  return <CustomerDetailPage uid={uid} />;
}
