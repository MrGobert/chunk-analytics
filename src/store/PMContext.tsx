'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';

export type TicketStatus = 'backlog' | 'todo' | 'in_progress' | 'done';

export interface Project {
    id: string;
    name: string;
    description: string;
    createdAt: string;
}

export interface Tag {
    id: string;
    name: string;
    color: string;
}

export interface Attachment {
    id: string;
    name: string;
    url: string;
    type: 'link' | 'file';
}

export interface Ticket {
    id: string;
    projectId: string;
    title: string;
    description: string;
    status: TicketStatus;
    tagIds: string[];
    attachments?: Attachment[];
    createdAt: string;
    order: number;
}

interface PMContextType {
    projects: Project[];
    tags: Tag[];
    tickets: Ticket[];
    activeProjectId: string | null;
    isLoaded: boolean;
    addProject: (p: Omit<Project, 'id' | 'createdAt'>) => void;
    updateProject: (id: string, p: Partial<Project>) => void;
    deleteProject: (id: string) => void;
    setActiveProject: (id: string | null) => void;
    addTag: (t: Omit<Tag, 'id'>) => void;
    updateTag: (id: string, t: Partial<Tag>) => void;
    deleteTag: (id: string) => void;
    addTicket: (t: Omit<Ticket, 'id' | 'createdAt' | 'order'>) => void;
    updateTicket: (id: string, t: Partial<Ticket>) => void;
    deleteTicket: (id: string) => void;
    reorderTickets: (tickets: Ticket[]) => void;
}

const PMContext = createContext<PMContextType | undefined>(undefined);

export function PMProvider({ children }: { children: React.ReactNode }) {
    const [projects, setProjects] = useState<Project[]>([]);
    const [tags, setTags] = useState<Tag[]>([]);
    const [tickets, setTickets] = useState<Ticket[]>([]);
    const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
    const [isLoaded, setIsLoaded] = useState(false);

    // Initial Fetch from Next.js Proxy API
    useEffect(() => {
        const fetchData = async () => {
            try {
                const res = await fetch('/api/pm/sync', { cache: 'no-store' });
                if (!res.ok) throw new Error('API Sync Failed');

                const data = await res.json();

                setProjects(data.projects || []);
                setTags(data.tags || []);
                setTickets((data.tickets || []).sort((a: Ticket, b: Ticket) => a.order - b.order));

                const storedActiveProject = localStorage.getItem('pm_activeProject');
                if (storedActiveProject) setActiveProjectId(storedActiveProject);
            } catch (error) {
                console.error("Error fetching PM data from Server API:", error);
            } finally {
                setIsLoaded(true);
            }
        };

        fetchData();
    }, []);

    // Save Active Project to local storage only
    useEffect(() => {
        if (!isLoaded) return;
        if (activeProjectId) {
            localStorage.setItem('pm_activeProject', activeProjectId);
        } else {
            localStorage.removeItem('pm_activeProject');
        }
    }, [activeProjectId, isLoaded]);

    const generateId = () => crypto.randomUUID();

    const pushSync = async (action: string, data: any) => {
        try {
            await fetch('/api/pm/sync', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action, data })
            });
        } catch (e) {
            console.error("Failed server sync:", e);
        }
    };

    // ------------------- Projects -------------------
    const addProject = (p: Omit<Project, 'id' | 'createdAt'>) => {
        const newProject: Project = { ...p, id: generateId(), createdAt: new Date().toISOString() };

        setProjects((prev) => [...prev, newProject]);
        if (!activeProjectId) setActiveProjectId(newProject.id);

        pushSync('setDoc', { collection: 'projects', id: newProject.id, payload: newProject });
    };

    const updateProject = (id: string, p: Partial<Project>) => {
        setProjects((prev) => prev.map((proj) => proj.id === id ? { ...proj, ...p } : proj));
        pushSync('setDoc', { collection: 'projects', id, payload: p, merge: true });
    };

    const deleteProject = (id: string) => {
        setProjects((prev) => prev.filter((proj) => proj.id !== id));
        const projectTickets = tickets.filter(t => t.projectId === id);
        setTickets((prev) => prev.filter((t) => t.projectId !== id));
        if (activeProjectId === id) setActiveProjectId(null);

        const operations = [
            { type: 'delete', collection: 'projects', id },
            ...projectTickets.map(t => ({ type: 'delete', collection: 'tickets', id: t.id }))
        ];

        pushSync('writeBatch', { operations });
    };

    // ------------------- Tags -------------------
    const addTag = (t: Omit<Tag, 'id'>) => {
        const newTag: Tag = { ...t, id: generateId() };
        setTags((prev) => [...prev, newTag]);
        pushSync('setDoc', { collection: 'tags', id: newTag.id, payload: newTag });
    };

    const updateTag = (id: string, t: Partial<Tag>) => {
        setTags((prev) => prev.map((tag) => tag.id === id ? { ...tag, ...t } : tag));
        pushSync('setDoc', { collection: 'tags', id, payload: t, merge: true });
    };

    const deleteTag = (id: string) => {
        setTags((prev) => prev.filter((tag) => tag.id !== id));
        const affectedTickets = tickets.filter(tk => tk.tagIds.includes(id));
        setTickets((prev) => prev.map((tk) => ({ ...tk, tagIds: tk.tagIds.filter(_id => _id !== id) })));

        const operations = [
            { type: 'delete', collection: 'tags', id },
            ...affectedTickets.map(t => ({
                type: 'update',
                collection: 'tickets',
                id: t.id,
                payload: { tagIds: t.tagIds.filter(_id => _id !== id) }
            }))
        ];

        pushSync('writeBatch', { operations });
    };

    // ------------------- Tickets -------------------
    const addTicket = (t: Omit<Ticket, 'id' | 'createdAt' | 'order'>) => {
        let newTicket: Ticket | undefined;
        setTickets((prev) => {
            const maxOrder = Math.max(0, ...prev.filter(x => x.projectId === t.projectId && x.status === t.status).map(x => x.order));
            newTicket = {
                ...t,
                id: generateId(),
                createdAt: new Date().toISOString(),
                order: maxOrder + 1
            };
            return [...prev, newTicket];
        });

        if (newTicket) {
            pushSync('setDoc', { collection: 'tickets', id: newTicket.id, payload: newTicket });
        }
    };

    const updateTicket = (id: string, t: Partial<Ticket>) => {
        setTickets((prev) => prev.map((tk) => tk.id === id ? { ...tk, ...t } : tk));
        pushSync('setDoc', { collection: 'tickets', id, payload: t, merge: true });
    };

    const deleteTicket = (id: string) => {
        setTickets((prev) => prev.filter((tk) => tk.id !== id));
        pushSync('deleteDoc', { collection: 'tickets', id });
    };

    const reorderTickets = (reorderedTickets: Ticket[]) => {
        setTickets(reorderedTickets);

        const operations = reorderedTickets.map(ticket => ({
            type: 'update',
            collection: 'tickets',
            id: ticket.id,
            payload: { order: ticket.order, status: ticket.status }
        }));

        pushSync('writeBatch', { operations });
    };

    return (
        <PMContext.Provider value={{
            projects, tags, tickets, activeProjectId, isLoaded,
            addProject, updateProject, deleteProject, setActiveProject: setActiveProjectId,
            addTag, updateTag, deleteTag,
            addTicket, updateTicket, deleteTicket, reorderTickets
        }}>
            {children}
        </PMContext.Provider>
    );
}

export const usePM = () => {
    const context = useContext(PMContext);
    if (context === undefined) {
        throw new Error('usePM must be used within a PMProvider');
    }
    return context;
};
