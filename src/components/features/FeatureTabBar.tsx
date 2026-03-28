'use client';

import { Search, FileText, StickyNote, FolderOpen, Sparkles, Share2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';

export interface FeatureTab {
  id: string;
  label: string;
  icon: LucideIcon;
}

export const FEATURE_TABS: FeatureTab[] = [
  { id: 'search', label: 'Search', icon: Search },
  { id: 'research', label: 'Research', icon: FileText },
  { id: 'notes', label: 'Notes', icon: StickyNote },
  { id: 'collections', label: 'Collections', icon: FolderOpen },
  { id: 'artifacts', label: 'Artifacts', icon: Sparkles },
  { id: 'sharing', label: 'Sharing', icon: Share2 },
];

interface FeatureTabBarProps {
  activeTab: string;
  onTabChange: (tabId: string) => void;
}

export default function FeatureTabBar({ activeTab, onTabChange }: FeatureTabBarProps) {
  return (
    <div className="flex gap-1 p-1 rounded-2xl bg-primary/60 backdrop-blur-xl border border-white/5 overflow-x-auto">
      {FEATURE_TABS.map((tab) => {
        const Icon = tab.icon;
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={cn(
              'flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 whitespace-nowrap',
              isActive
                ? 'bg-accent text-white shadow-lg shadow-accent/25'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/5'
            )}
          >
            <Icon size={16} />
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
