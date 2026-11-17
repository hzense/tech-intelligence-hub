'use client';

import { Analytics } from '@vercel/analytics/next';
import { usePathname } from 'next/navigation';
import { filterPublicPageview, isPublicAnalyticsPath } from '@/lib/public-web-analytics';

export function PublicWebAnalytics() {
  const pathname = usePathname();
  if (!isPublicAnalyticsPath(pathname)) return null;

  return <Analytics mode="production" debug={false} beforeSend={filterPublicPageview} />;
}
