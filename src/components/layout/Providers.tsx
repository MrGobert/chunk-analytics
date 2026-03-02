'use client';

import { AnalyticsCacheProvider } from '@/hooks/useAnalytics';

export default function Providers({ children }: { children: React.ReactNode }) {
  return <AnalyticsCacheProvider>{children}</AnalyticsCacheProvider>;
}
