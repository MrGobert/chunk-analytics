export function customerDetailHref(uid: string): string {
  const search = new URLSearchParams({ uid });
  return `/customers/detail?${search.toString()}`;
}
