'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { ArrowLeft, Mail, Clock, Zap, Calendar, Eye, X } from 'lucide-react';
import { useAnalytics } from '@/hooks/useAnalytics';

interface EmailTemplate {
  id: string;
  name: string;
  category: string;
  description: string;
  trigger: 'webhook' | 'beat' | 'manual';
  schedule: string;
}

interface TemplatePreview extends EmailTemplate {
  subject: string;
  html: string;
}

const CATEGORY_ORDER = [
  'Welcome Sequence',
  'Trial & Subscription',
  'Engagement',
  'Win-back',
  'Announcements',
];

const TRIGGER_CONFIG = {
  webhook: { label: 'Webhook', icon: Zap, color: 'text-sage-deep', bg: 'bg-sage-tint border-sage/30' },
  beat: { label: 'Scheduled', icon: Clock, color: 'text-ink', bg: 'bg-lake-tint border-lake/30' },
  manual: { label: 'Manual', icon: Calendar, color: 'text-ink', bg: 'bg-butter-tint border-butter/50' },
};

export default function EmailTemplatesPage() {
  const { data: templateData, isLoading: loading, error: fetchError } =
    useAnalytics<{ templates: EmailTemplate[] }>('/api/email-templates', {});
  const templates = templateData?.templates || [];
  const [selectedTemplate, setSelectedTemplate] = useState<TemplatePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (fetchError) setError(fetchError);
  }, [fetchError]);

  const openPreview = useCallback(async (template: EmailTemplate) => {
    setPreviewLoading(true);
    setSelectedTemplate(null);

    try {
      const res = await fetch(`/api/email-templates/${template.id}`);
      const data = await res.json();
      setSelectedTemplate(data);
    } catch {
      setError('Failed to load preview');
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  // Close modal on escape
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedTemplate(null);
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, []);

  // Group templates by category
  const grouped = templates.reduce<Record<string, EmailTemplate[]>>((acc, tpl) => {
    if (!acc[tpl.category]) acc[tpl.category] = [];
    acc[tpl.category].push(tpl);
    return acc;
  }, {});

  const sortedCategories = CATEGORY_ORDER.filter(c => grouped[c]);

  if (loading) {
    return (
      <div className="animate-in fade-in duration-300">
        <div className="mb-8">
          <div className="h-10 w-64 skeleton rounded-btn mb-3" />
          <div className="h-5 w-96 skeleton rounded-chip" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="h-40 skeleton rounded-card" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex items-center gap-4 mb-2">
        <Link
          href="/outreach"
          className="p-2 rounded-btn text-ink-soft hover:text-ink hover:bg-paper-deep transition-all"
        >
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-3xl md:text-4xl font-bold font-sans tracking-tight text-ink">
            Email Templates
          </h1>
          <p className="text-ink-faint mt-1 font-medium">
            {templates.length} active templates · Click to preview
          </p>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-ember-tint border border-ember/30 rounded-card text-ember-deep text-sm">
          {error}
        </div>
      )}

      {/* Template Grid */}
      {sortedCategories.map((category) => (
        <div key={category} className="mb-8">
          <h2 className="text-xs font-mono font-bold text-ink-faint uppercase tracking-widest mb-4 pl-1">
            {category}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {grouped[category].map((tpl) => {
              const trigger = TRIGGER_CONFIG[tpl.trigger];
              const TriggerIcon = trigger.icon;

              return (
                <button
                  key={tpl.id}
                  onClick={() => openPreview(tpl)}
                  className="group text-left card-surface card-hover rounded-card p-5"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="p-2 rounded-xl bg-accent/10 text-accent">
                      <Mail className="w-4 h-4" />
                    </div>
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-mono font-bold uppercase tracking-wider border ${trigger.bg}`}>
                      <TriggerIcon className={`w-3 h-3 ${trigger.color}`} />
                      <span className={trigger.color}>{trigger.label}</span>
                    </span>
                  </div>
                  <h3 className="text-base font-bold font-sans tracking-tight text-ink mb-1.5 group-hover:text-accent transition-colors">
                    {tpl.name}
                  </h3>
                  <p className="text-sm text-ink-faint leading-relaxed mb-3">
                    {tpl.description}
                  </p>
                  <div className="flex items-center gap-1.5 text-[11px] font-mono text-ink-faint">
                    <Clock className="w-3 h-3" />
                    {tpl.schedule}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ))}

      {/* Preview Modal */}
      {(selectedTemplate || previewLoading) && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelectedTemplate(null);
          }}
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-[rgba(45,36,24,0.35)] backdrop-blur-sm" />

          {/* Modal */}
          <div
            ref={modalRef}
            className="relative w-full max-w-4xl h-[90vh] bg-card rounded-panel border border-line shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 fade-in duration-200"
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-line shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <div className="p-2 rounded-xl bg-accent/10 text-accent shrink-0">
                  <Mail className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-base font-bold font-sans tracking-tight text-ink truncate">
                    {selectedTemplate?.name || 'Loading...'}
                  </h3>
                  {selectedTemplate?.subject && (
                    <p className="text-xs font-mono text-ink-faint truncate mt-0.5">
                      Subject: {selectedTemplate.subject}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {selectedTemplate && (
                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-mono font-bold uppercase tracking-wider border ${TRIGGER_CONFIG[selectedTemplate.trigger].bg}`}>
                    <span className={TRIGGER_CONFIG[selectedTemplate.trigger].color}>
                      {TRIGGER_CONFIG[selectedTemplate.trigger].label}
                    </span>
                  </span>
                )}
                <button
                  onClick={() => setSelectedTemplate(null)}
                  className="p-2 rounded-btn text-ink-soft hover:text-ink hover:bg-paper-deep transition-all"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Modal Body — iframe preview */}
            <div className="flex-1 overflow-hidden bg-[#EAEAEA]" style={{ minHeight: '70vh' }}>
              {previewLoading ? (
                <div className="flex items-center justify-center h-full">
                  <div className="flex flex-col items-center gap-3">
                    <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                    <span className="text-sm font-mono text-ink-faint">Loading preview...</span>
                  </div>
                </div>
              ) : selectedTemplate?.html ? (
                <iframe
                  srcDoc={selectedTemplate.html}
                  className="w-full h-full border-0"
                  title={`Preview: ${selectedTemplate.name}`}
                  sandbox="allow-same-origin"
                />
              ) : (
                <div className="flex items-center justify-center h-full text-ink-faint">
                  Failed to load preview
                </div>
              )}
            </div>

            {/* Modal Footer */}
            {selectedTemplate && (
              <div className="px-6 py-3 border-t border-line shrink-0">
                <div className="flex items-center gap-2 text-xs font-mono text-ink-faint">
                  <Clock className="w-3 h-3" />
                  {selectedTemplate.schedule}
                  <span className="text-ink-faint mx-1">·</span>
                  {selectedTemplate.description}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
