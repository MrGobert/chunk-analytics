'use client';

import { Search, FileText, StickyNote, FolderOpen, Sparkles, Share2, Plug, Link2 } from 'lucide-react';
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
  { id: 'connections', label: 'Connections', icon: Link2 },
  { id: 'connectors', label: 'Connectors', icon: Plug },
];

interface FeatureTabBarProps {
  activeTab: string;
  onTabChange: (tabId: string) => void;
}

export default function FeatureTabBar({ activeTab, onTabChange }: FeatureTabBarProps) {
  return (
    <div className="flex gap-1 p-1 rounded-btn bg-card border border-line shadow-card overflow-x-auto">
      {FEATURE_TABS.map((tab) => {
        const Icon = tab.icon;
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={cn(
              'flex items-center gap-2 px-4 py-2.5 rounded-chip text-sm font-medium transition-all duration-200 whitespace-nowrap',
              isActive
                ? 'bg-ember-deep text-[#FFF8F2]'
                : 'text-ink-soft hover:text-ink hover:bg-paper-deep'
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
