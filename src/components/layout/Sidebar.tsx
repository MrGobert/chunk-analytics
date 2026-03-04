'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { useState, useEffect } from 'react';
import { useAnalyticsPrefetch } from '@/hooks/useAnalytics';
import {
  Home,
  Filter,
  Megaphone,
  BarChart2,
  Users,
  Search,
  CreditCard,
  Bell,
  Mail,
  LayoutGrid,
  FileText,
  StickyNote,
  FolderOpen,
  Share2,
  Rocket,
  Menu,
  X,
  Eye
} from 'lucide-react';

// Map sidebar href to the API endpoint each page fetches
const ROUTE_TO_ENDPOINT: Record<string, string> = {
  '/': '/api/metrics/overview',
  '/acquisition': '/api/metrics/acquisition',
  '/marketing': '/api/metrics/marketing',
  '/insights': '/api/metrics/advanced',
  '/users': '/api/metrics/users',
  '/searches': '/api/metrics/searches',
  '/subscriptions': '/api/metrics/funnel',
  '/push': '/api/metrics/push',
  '/emails': '/api/metrics/emails',
  '/features': '/api/metrics/features',
  '/research': '/api/metrics/research',
  '/notes': '/api/metrics/notes',
  '/collections': '/api/metrics/collections',
  '/sharing': '/api/metrics/sharing',
  '/onboarding': '/api/metrics/onboarding',
};

const navItems = [
  { href: '/', label: 'Overview', icon: Home },
  { href: '/acquisition', label: 'Acquisition', icon: Filter },
  { href: '/marketing', label: 'Marketing', icon: Megaphone },
  { href: '/insights', label: 'Insights', icon: BarChart2 },
  { href: '/users', label: 'Users', icon: Users },
  { href: '/searches', label: 'Searches', icon: Search },
  { href: '/subscriptions', label: 'Subscriptions', icon: CreditCard },
  { href: '/push', label: 'Push Notifications', icon: Bell },
  { href: '/emails', label: 'Email Campaigns', icon: Mail },
  { href: '/features', label: 'Features', icon: LayoutGrid },
  { href: '/research', label: 'Research', icon: FileText },
  { href: '/notes', label: 'Notes', icon: StickyNote },
  { href: '/collections', label: 'Collections', icon: FolderOpen },
  { href: '/sharing', label: 'Sharing', icon: Share2 },
  { href: '/onboarding', label: 'Onboarding', icon: Rocket },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const prefetch = useAnalyticsPrefetch();

  // Close sidebar when route changes (mobile)
  useEffect(() => {
    setIsOpen(false);
  }, [pathname]);

  // Close sidebar on escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, []);

  // Prefetch adjacent tabs when user lands on a page
  useEffect(() => {
    const currentIndex = navItems.findIndex((item) => item.href === pathname);
    if (currentIndex === -1) return;

    // Delay prefetch slightly so current page loads first
    const timer = setTimeout(() => {
      const adjacentIndices = [
        currentIndex - 1,
        currentIndex + 1,
        currentIndex + 2,
      ].filter((i) => i >= 0 && i < navItems.length && i !== currentIndex);

      for (const idx of adjacentIndices) {
        const route = navItems[idx].href;
        const endpoint = ROUTE_TO_ENDPOINT[route];
        if (!endpoint) continue;

        // Emails page uses different params
        if (route === '/emails') {
          prefetch(endpoint, { days: '30' });
        } else {
          prefetch(endpoint, { range: '30d', platform: 'all', userType: 'all' });
        }
      }
    }, 2000);

    return () => clearTimeout(timer);
  }, [pathname, prefetch]);

  return (
    <>
      {/* Mobile header */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-40 bg-surface-dark border-b border-zinc-900 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center justify-center">
          <Image src="/chunk-logo-white.png" alt="Chunk Logo" width={100} height={28} className="w-auto h-7 object-contain" />
        </div>
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="p-2 text-zinc-500 hover:text-white transition-colors"
          aria-label="Toggle menu"
        >
          {isOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </div>

      {/* Mobile overlay */}
      {isOpen && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed left-0 top-0 h-screen w-64 bg-surface-dark border-r border-zinc-900 flex flex-col z-50
          transition-transform duration-300 ease-in-out
          lg:translate-x-0
          ${isOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
      >
        <div className="p-6 border-b border-zinc-900">
          <div className="flex items-center justify-center py-2">
            <Image src="/chunk-logo-white.png" alt="Chunk Logo" width={120} height={36} className="w-auto h-9 object-contain" />
          </div>
        </div>

        <nav className="flex-1 p-4 overflow-y-auto">
          <ul className="space-y-2">
            {navItems.map((item) => {
              const isActive = pathname === item.href;
              const Icon = item.icon;

              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={`flex items-center gap-3 px-4 py-3 rounded-[2rem] transition-all duration-300 hover-lift ${isActive
                      ? 'bg-accent text-white font-medium'
                      : 'text-zinc-500 hover:text-white hover:bg-primary font-medium'
                      }`}
                  >
                    <Icon className="w-5 h-5" strokeWidth={isActive ? 2.5 : 2} />
                    <span className="font-sans tracking-tight">{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="p-4 border-t border-zinc-900 space-y-3">
          <Link
            href="/emails/templates"
            className={`flex items-center gap-3 px-4 py-3 rounded-[2rem] transition-all duration-300 hover-lift ${
              pathname === '/emails/templates'
                ? 'bg-accent text-white font-medium'
                : 'text-zinc-600 hover:text-white hover:bg-primary font-medium'
            }`}
          >
            <Eye className="w-4 h-4" strokeWidth={pathname === '/emails/templates' ? 2.5 : 2} />
            <span className="font-sans tracking-tight text-sm">Email Templates</span>
          </Link>
          <div className="text-xs font-mono text-zinc-600 text-center tracking-tight">
            SYSTEM.ANALYTICS
          </div>
        </div>
      </aside>
    </>
  );
}
