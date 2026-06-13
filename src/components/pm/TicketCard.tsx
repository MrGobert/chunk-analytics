'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Ticket, usePM } from '@/store/PMContext';
import { AlignLeft, Paperclip } from 'lucide-react';

/** Tag colours were picked for a dark board; on cream, force ink text when a colour is too light. */
function tagTextColor(hex: string): string {
  const m = hex.replace('#', '');
  if (m.length < 6) return '#2D2418';
  const r = parseInt(m.slice(0, 2), 16);
  const g = parseInt(m.slice(2, 4), 16);
  const b = parseInt(m.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? '#2D2418' : hex;
}

interface TicketCardProps {
    ticket: Ticket;
    onClick?: () => void;
    isOverlay?: boolean;
}

export default function TicketCard({ ticket, onClick, isOverlay }: TicketCardProps) {
    const { tags } = usePM();

    const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
        id: ticket.id,
        data: { type: 'Ticket', ticket }
    });

    const style = {
        transition,
        transform: CSS.Transform.toString(transform),
    };

    const ticketTags = tags.filter(t => ticket.tagIds.includes(t.id));

    if (isDragging && !isOverlay) {
        return (
            <div ref={setNodeRef} style={style} className="h-24 bg-paper-deep border-2 border-dashed border-line rounded-btn" />
        );
    }

    return (
        <div
            ref={setNodeRef}
            style={style}
            {...attributes}
            {...listeners}
            onClick={onClick}
            className={`
        card-surface rounded-btn p-4 cursor-grab active:cursor-grabbing hover:-translate-y-0.5 hover:border-ink/30 hover:shadow-lift transition-all
        ${isOverlay ? 'rotate-2 scale-105 shadow-lift opacity-95' : ''}
      `}
        >
            <div className="flex flex-wrap gap-1.5 mb-2">
                {ticketTags.map(tag => (
                    <span key={tag.id} className="text-[10px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: `${tag.color}1A`, color: tagTextColor(tag.color), border: `1px solid ${tag.color}55` }}>
                        {tag.name}
                    </span>
                ))}
            </div>
            <h3 className="text-ink text-sm font-medium leading-snug mb-2">{ticket.title}</h3>
            {(ticket.description || (ticket.attachments && ticket.attachments.length > 0)) && (
                <div className="flex items-center gap-3 text-ink-faint">
                    {ticket.description && <AlignLeft className="w-3.5 h-3.5" />}
                    {(ticket.attachments && ticket.attachments.length > 0) && (
                        <div className="flex items-center gap-1">
                            <Paperclip className="w-3.5 h-3.5" />
                            <span className="text-[10px] font-mono">{ticket.attachments.length}</span>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
