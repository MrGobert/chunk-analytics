'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { useState, useEffect } from 'react';
import { useAnalyticsPrefetch } from '@/hooks/useAnalytics';
import {
  Home,
  BarChart2,
  Mail,
  LayoutGrid,
  Rocket,
  Globe,
  Menu,
  X,
  Eye,
  DollarSign,
  Users,
  Zap,
  Repeat,
  CreditCard,
  KanbanSquare,
  Tags,
  Briefcase,
  Bug,
  Activity,
  type LucideIcon,
} from 'lucide-react';

// Map sidebar href to the API endpoint each page fetches (for prefetching)
const ROUTE_TO_ENDPOINT: Record<string, string> = {
  '/': '/api/metrics/pulse',
  '/revenue': '/api/rc/revenue-summary',
  '/conversion': '/api/metrics/monetization',
  '/customers': '/api/rc/churn-intelligence',
  '/acquisition': '/api/metrics/acquisition',
  '/activation': '/api/metrics/activation',
  '/retention': '/api/metrics/retention-cohorts',
  '/engagement': '/api/metrics/users',
  '/features': '/api/metrics/feature-overview',
  '/capture-monitors': '/api/metrics/capture-monitors',
  '/outreach': '/api/metrics/emails',
  '/health': '/api/sentry/stats',
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
    title: 'TODAY',
    items: [{ href: '/', label: 'Pulse', icon: Home }],
  },
  {
    title: 'BUSINESS',
    items: [
      { href: '/revenue', label: 'Revenue', icon: DollarSign },
      { href: '/conversion', label: 'Conversion', icon: CreditCard },
      { href: '/customers', label: 'Customers', icon: Users },
    ],
  },
  {
    title: 'GROWTH',
    items: [
      { href: '/acquisition', label: 'Acquisition', icon: Rocket },
      { href: '/activation', label: 'Activation', icon: Zap },
      { href: '/retention', label: 'Retention', icon: Repeat },
    ],
  },
  {
    title: 'PRODUCT',
    items: [
      { href: '/engagement', label: 'Engagement', icon: Activity },
      { href: '/features', label: 'Features', icon: LayoutGrid },
      { href: '/capture-monitors', label: 'Capture & Automations', icon: Eye },
    ],
  },
  {
    title: 'OPERATIONS',
    items: [
      { href: '/outreach', label: 'Email', icon: Mail },
      { href: '/health', label: 'Health', icon: Bug },
    ],
  },
];

const pmNavSections: NavSection[] = [
  {
    title: 'PRODUCT MANAGEMENT',
    items: [
      { href: '/pm', label: 'Kanban Board', icon: KanbanSquare },
      { href: '/pm/projects', label: 'Projects', icon: Briefcase },
      { href: '/pm/tags', label: 'Tags & Labels', icon: Tags },
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

        if (route === '/outreach') {
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

  const isPmMode = pathname.startsWith('/pm');
  const activeSections = isPmMode ? pmNavSections : navSections;

  return (
    <>
      {/* Mobile header */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-40 bg-paper/85 backdrop-blur-[12px] border-b border-line px-4 py-3 flex items-center justify-between">
        <div className="flex items-center text-ink">
          <Image src="/chunk-logo.svg" alt="Chunk" width={100} height={24} className="w-auto h-6 object-contain" />
        </div>
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="p-2 text-ink-soft hover:text-ink transition-colors"
          aria-label="Toggle menu"
        >
          {isOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </div>

      {/* Mobile overlay — warm scrim, never black */}
      {isOpen && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-[rgba(45,36,24,0.35)] backdrop-blur-sm"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed left-0 top-0 h-screen w-64 bg-paper border-r border-line flex flex-col z-50
          transition-transform duration-300 ease-in-out
          lg:translate-x-0
          ${isOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
      >
        <div className="p-6 border-b border-line">
          <div className="flex items-center py-2 text-ink">
            <Image src="/chunk-logo.svg" alt="Chunk" width={120} height={28} className="w-auto h-7 object-contain" />
          </div>
        </div>

        <nav className="flex-1 p-4 overflow-y-auto">
          {activeSections.map((section) => (
            <div key={section.title} className="mb-6">
              <div className="px-4 mb-2">
                <span className="eyebrow text-ink-faint">{section.title}</span>
              </div>
              <ul className="space-y-1">
                {section.items.map((item) => {
                  const isActive = pathname === item.href;
                  const Icon = item.icon;

                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className={`flex items-center gap-3 px-4 py-2.5 rounded-btn transition-all duration-200 ${
                          isActive
                            ? 'bg-ember-tint border border-ember/20 text-ember-deep font-semibold'
                            : 'text-ink-soft hover:text-ink hover:bg-paper-deep font-medium border border-transparent'
                        }`}
                      >
                        <Icon className="w-4 h-4" strokeWidth={isActive ? 2.5 : 2} />
                        <span className="tracking-tight text-sm">{item.label}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="p-4 border-t border-line space-y-3">
          {isPmMode ? (
            <Link
              href="/"
              className="flex items-center justify-center gap-3 px-4 py-3 rounded-btn transition-all duration-200 bg-card border border-line text-ink hover:bg-paper-deep font-medium w-full"
            >
              <BarChart2 className="w-4 h-4" />
              <span className="tracking-tight text-sm">Exit PM Mode</span>
            </Link>
          ) : (
            <>
              <Link
                href="/emails/templates"
                className={`flex items-center gap-3 px-4 py-3 rounded-btn transition-all duration-200 ${
                  pathname === '/emails/templates'
                    ? 'bg-ember-tint border border-ember/20 text-ember-deep font-semibold'
                    : 'text-ink-soft hover:text-ink hover:bg-paper-deep font-medium border border-transparent'
                }`}
              >
                <Eye className="w-4 h-4" strokeWidth={pathname === '/emails/templates' ? 2.5 : 2} />
                <span className="tracking-tight text-sm">Email Templates</span>
              </Link>
              <Link
                href="/pm"
                className="flex items-center justify-center gap-3 px-4 py-3 rounded-btn transition-all duration-200 bg-card border border-line text-ink hover:bg-paper-deep font-medium w-full"
              >
                <KanbanSquare className="w-4 h-4" />
                <span className="tracking-tight text-sm">Enter PM Mode</span>
              </Link>
            </>
          )}
          <div className="text-xs font-mono text-ink-faint text-center tracking-tight mt-4">
            {isPmMode ? 'PRODUCT MANAGEMENT' : 'CHUNK COMMAND CENTER'}
          </div>
        </div>
      </aside>
    </>
  );
}
