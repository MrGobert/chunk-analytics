'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Ticket, usePM } from '@/store/PMContext';
import { AlignLeft, Paperclip } from 'lucide-react';

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
            <div ref={setNodeRef} style={style} className="h-24 bg-white/5 border-2 border-dashed border-white/20 rounded-xl" />
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
        bg-primary border border-white/10 rounded-xl p-4 cursor-grab active:cursor-grabbing hover:border-accent/40 hover:shadow-[0_0_15px_var(--accent-glow)] transition-all
        ${isOverlay ? 'rotate-2 scale-105 shadow-2xl glass-panel opacity-95' : ''}
      `}
        >
            <div className="flex flex-wrap gap-1.5 mb-2">
                {ticketTags.map(tag => (
                    <span key={tag.id} className="text-[10px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: `${tag.color}20`, color: tag.color, border: `1px solid ${tag.color}40` }}>
                        {tag.name}
                    </span>
                ))}
            </div>
            <h3 className="text-white text-sm font-medium leading-snug mb-2">{ticket.title}</h3>
            {(ticket.description || (ticket.attachments && ticket.attachments.length > 0)) && (
                <div className="flex items-center gap-3 text-zinc-500">
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
