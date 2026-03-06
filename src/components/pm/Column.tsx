'use client';

import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Ticket, TicketStatus } from '@/store/PMContext';
import TicketCard from './TicketCard';
import { Plus } from 'lucide-react';

interface ColumnProps {
    column: { id: TicketStatus; title: string; tickets: Ticket[] };
    onAddTicket: () => void;
    onEditTicket: (id: string) => void;
}

export default function Column({ column, onAddTicket, onEditTicket }: ColumnProps) {
    const { setNodeRef } = useDroppable({
        id: column.id,
        data: { type: 'Column', column }
    });

    return (
        <div ref={setNodeRef} className="flex flex-col bg-black/40 border border-white/5 rounded-2xl w-80 min-w-[320px] max-h-full">
            <div className="flex items-center justify-between p-4 border-b border-white/5 cursor-grab">
                <div className="flex items-center gap-2">
                    <h2 className="font-semibold text-white tracking-wide">{column.title}</h2>
                    <span className="bg-white/10 text-zinc-300 text-xs py-0.5 px-2 rounded-full font-mono">{column.tickets.length}</span>
                </div>
                <button onClick={onAddTicket} className="p-1.5 text-zinc-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors">
                    <Plus className="w-4 h-4" />
                </button>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-3 min-h-[150px]">
                <SortableContext items={column.tickets.map(t => t.id)} strategy={verticalListSortingStrategy}>
                    {column.tickets.map(ticket => (
                        <TicketCard key={ticket.id} ticket={ticket} onClick={() => onEditTicket(ticket.id)} />
                    ))}
                </SortableContext>
            </div>
        </div>
    );
}
