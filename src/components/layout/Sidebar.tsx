'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { useState, useEffect } from 'react';
import { useAnalyticsPrefetch } from '@/hooks/useAnalytics';
import {
  Home,
  Filter,
  BarChart2,
  Users,
  Search,
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
  Eye,
  DollarSign,
  RefreshCw,
  AlertTriangle,
  type LucideIcon,
} from 'lucide-react';

// Map sidebar href to the API endpoint each page fetches
const ROUTE_TO_ENDPOINT: Record<string, string> = {
  '/': '/api/metrics/overview',
  '/revenue': '/api/rc/revenue-summary',
  '/funnel': '/api/rc/subscriber-funnel',
  '/churn': '/api/rc/churn-intelligence',
  '/acquisition': '/api/metrics/acquisition',
  '/insights': '/api/metrics/advanced',
  '/users': '/api/metrics/users',
  '/searches': '/api/metrics/searches',
  '/push': '/api/metrics/push',
  '/emails': '/api/metrics/emails',
  '/features': '/api/metrics/features',
  '/research': '/api/metrics/research',
  '/notes': '/api/metrics/notes',
  '/collections': '/api/metrics/collections',
  '/sharing': '/api/metrics/sharing',
};

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

const navSections: NavSection[] = [
  {
    title: 'COMMAND CENTER',
    items: [
      { href: '/', label: 'Overview', icon: Home },
      { href: '/revenue', label: 'Revenue', icon: DollarSign },
      { href: '/funnel', label: 'Subscriber Funnel', icon: RefreshCw },
      { href: '/churn', label: 'Churn Intelligence', icon: AlertTriangle },
    ],
  },
  {
    title: 'PRODUCT ANALYTICS',
    items: [
      { href: '/searches', label: 'Searches', icon: Search },
      { href: '/research', label: 'Research', icon: FileText },
      { href: '/notes', label: 'Notes', icon: StickyNote },
      { href: '/collections', label: 'Collections', icon: FolderOpen },
      { href: '/features', label: 'Features', icon: LayoutGrid },
      { href: '/acquisition', label: 'Acquisition', icon: Rocket },
    ],
  },
  {
    title: 'OPERATIONS',
    items: [
      { href: '/emails', label: 'Email Campaigns', icon: Mail },
      { href: '/users', label: 'Users', icon: Users },
      { href: '/push', label: 'Push Notifications', icon: Bell },
      { href: '/sharing', label: 'Sharing', icon: Share2 },
    ],
  },
];

// Flat list for prefetching
const allNavItems = navSections.flatMap((s) => s.items);

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
    const currentIndex = allNavItems.findIndex((item) => item.href === pathname);
    if (currentIndex === -1) return;

    const timer = setTimeout(() => {
      const adjacentIndices = [
        currentIndex - 1,
        currentIndex + 1,
        currentIndex + 2,
      ].filter((i) => i >= 0 && i < allNavItems.length && i !== currentIndex);

      for (const idx of adjacentIndices) {
        const route = allNavItems[idx].href;
        const endpoint = ROUTE_TO_ENDPOINT[route];
        if (!endpoint) continue;

        if (route === '/emails') {
          prefetch(endpoint, { days: '30' });
        } else if (endpoint.startsWith('/api/rc/')) {
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
      <div className="lg:hidden fixed top-0 left-0 right-0 z-40 bg-black/60 backdrop-blur-md border-b border-white/5 px-4 py-3 flex items-center justify-between">
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
          fixed left-0 top-0 h-screen w-64 bg-black/40 backdrop-blur-2xl border-r border-white/5 flex flex-col z-50
          transition-transform duration-300 ease-in-out
          lg:translate-x-0
          ${isOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
      >
        <div className="p-6 border-b border-white/5">
          <div className="flex items-center justify-center py-2">
            <Image src="/chunk-logo-white.png" alt="Chunk Logo" width={120} height={36} className="w-auto h-9 object-contain" />
          </div>
        </div>

        <nav className="flex-1 p-4 overflow-y-auto">
          {navSections.map((section) => (
            <div key={section.title} className="mb-6">
              <div className="px-4 mb-2">
                <span className="text-[10px] font-mono font-bold text-zinc-600 uppercase tracking-[0.15em]">
                  {section.title}
                </span>
              </div>
              <ul className="space-y-1">
                {section.items.map((item) => {
                  const isActive = pathname === item.href;
                  const Icon = item.icon;

                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className={`flex items-center gap-3 px-4 py-2.5 rounded-[1rem] transition-all duration-300 btn-magnetic ${isActive
                          ? 'bg-accent/10 border border-accent/30 text-accent font-medium shadow-[0_0_15px_var(--accent-glow)]'
                          : 'text-zinc-500 hover:text-white hover:bg-white/5 font-medium border border-transparent'
                          }`}
                      >
                        <Icon className="w-4 h-4" strokeWidth={isActive ? 2.5 : 2} />
                        <span className="font-sans tracking-tight text-sm">{item.label}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="p-4 border-t border-white/5 space-y-3">
          <Link
            href="/emails/templates"
            className={`flex items-center gap-3 px-4 py-3 rounded-[1rem] transition-all duration-300 btn-magnetic ${
              pathname === '/emails/templates'
                ? 'bg-accent/10 border border-accent/30 text-accent font-medium shadow-[0_0_15px_var(--accent-glow)]'
                : 'text-zinc-500 hover:text-white hover:bg-white/5 font-medium border border-transparent'
            }`}
          >
            <Eye className="w-4 h-4" strokeWidth={pathname === '/emails/templates' ? 2.5 : 2} />
            <span className="font-sans tracking-tight text-sm">Email Templates</span>
          </Link>
          <div className="text-xs font-mono text-zinc-600 text-center tracking-tight">
            CHUNK COMMAND CENTER
          </div>
        </div>
      </aside>
    </>
  );
}
