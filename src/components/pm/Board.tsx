'use client';

import React, { useMemo, useState } from 'react';
import { DndContext, DragOverlay, pointerWithin, KeyboardSensor, PointerSensor, useSensor, useSensors, DragStartEvent, DragOverEvent, DragEndEvent } from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
import { usePM, Ticket, TicketStatus } from '@/store/PMContext';
import Column from './Column';
import TicketCard from './TicketCard';
import TicketModal from './TicketModal';

const COLUMNS: { id: TicketStatus; title: string }[] = [
    { id: 'backlog', title: 'Backlog' },
    { id: 'todo', title: 'To Do' },
    { id: 'in_progress', title: 'In Progress' },
    { id: 'done', title: 'Done' },
];

export default function Board() {
    const { tickets, activeProjectId, updateTicket, reorderTickets } = usePM();
    const [activeTicket, setActiveTicket] = useState<Ticket | null>(null);
    const [editingTicketId, setEditingTicketId] = useState<string | null>(null);
    const [isCreatingForStatus, setIsCreatingForStatus] = useState<TicketStatus | null>(null);

    const projectTickets = useMemo(() =>
        tickets.filter((t) => t.projectId === activeProjectId).sort((a, b) => a.order - b.order),
        [tickets, activeProjectId]);

    const columnsData = useMemo(() => {
        return COLUMNS.map(col => ({
            ...col,
            tickets: projectTickets.filter(t => t.status === col.id)
        }));
    }, [projectTickets]);

    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
        useSensor(KeyboardSensor)
    );

    const onDragStart = (event: DragStartEvent) => {
        const { active } = event;
        const ticket = projectTickets.find(t => t.id === active.id);
        if (ticket) setActiveTicket(ticket);
    };

    const onDragOver = (event: DragOverEvent) => {
        const { active, over } = event;
        if (!over) return;

        const activeId = String(active.id);
        const overId = String(over.id);
        if (activeId === overId) return;

        const activeIndex = projectTickets.findIndex(t => t.id === activeId);
        if (activeIndex === -1) return;

        const isOverTask = over.data.current?.type === 'Ticket';
        const isOverColumn = over.data.current?.type === 'Column' || COLUMNS.some(c => c.id === overId);

        if (isOverTask) {
            const overIndex = projectTickets.findIndex(t => t.id === overId);
            if (overIndex === -1) return;

            if (projectTickets[activeIndex].status !== projectTickets[overIndex].status) {
                const newTickets = [...projectTickets];
                newTickets[activeIndex] = { ...newTickets[activeIndex], status: newTickets[overIndex].status };
                const sorted = arrayMove(newTickets, activeIndex, overIndex);
                reorderTickets(tickets.map(t => sorted.find(s => s.id === t.id) || t));
            } else {
                const sorted = arrayMove(projectTickets, activeIndex, overIndex);
                reorderTickets(tickets.map(t => sorted.find(s => s.id === t.id) || t));
            }
        } else if (isOverColumn) {
            const targetStatus = (over.data.current?.column?.id || overId) as TicketStatus;
            if (projectTickets[activeIndex].status !== targetStatus) {
                const newTickets = [...projectTickets];
                newTickets[activeIndex] = { ...newTickets[activeIndex], status: targetStatus, order: projectTickets.length };
                reorderTickets(tickets.map(t => newTickets.find(s => s.id === t.id) || t));
            }
        }
    };

    const onDragEnd = (event: DragEndEvent) => {
        setActiveTicket(null);
        const { active, over } = event;
        if (!over) return;

        const activeId = String(active.id);
        // Force order reassignment across all columns to sanitize data after any drag
        let newAllTickets = [...tickets];
        COLUMNS.forEach(col => {
            const colTickets = newAllTickets
                .filter(t => t.projectId === activeProjectId && t.status === col.id)
                .sort((a, b) => a.order - b.order);

            colTickets.forEach((t, i) => {
                const index = newAllTickets.findIndex(x => x.id === t.id);
                if (index !== -1) {
                    newAllTickets[index] = { ...newAllTickets[index], order: i };
                }
            });
        });

        // Small timeout to allow state setter
        setTimeout(() => reorderTickets(newAllTickets), 0);
    };

    if (!activeProjectId) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center p-12 text-center h-[60vh] border-2 border-dashed border-white/5 rounded-2xl mx-4">
                <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center mb-4 text-zinc-500">
                    <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                    </svg>
                </div>
                <h3 className="text-xl font-bold text-white mb-2">No Project Selected</h3>
                <p className="text-zinc-400 max-w-sm">Create or select a project from the top menu to start organizing your tasks.</p>
            </div>
        );
    }

    return (
        <div className="flex-1 flex overflow-x-auto overflow-y-hidden px-1 pb-4 gap-6 items-start h-[calc(100vh-180px)] min-h-[500px]">
            <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd}>
                {columnsData.map(col => (
                    <Column
                        key={col.id}
                        column={col}
                        onAddTicket={() => setIsCreatingForStatus(col.id)}
                        onEditTicket={(ts) => setEditingTicketId(ts)}
                    />
                ))}

                <DragOverlay>
                    {activeTicket ? <TicketCard ticket={activeTicket} isOverlay /> : null}
                </DragOverlay>
            </DndContext>

            {(isCreatingForStatus || editingTicketId) && (
                <TicketModal
                    ticketId={editingTicketId}
                    initialStatus={isCreatingForStatus || undefined}
                    onClose={() => {
                        setIsCreatingForStatus(null);
                        setEditingTicketId(null);
                    }}
                />
            )}
        </div>
    );
}
