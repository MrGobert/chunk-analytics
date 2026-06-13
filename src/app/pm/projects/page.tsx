'use client';

import { useState } from 'react';
import { usePM } from '@/store/PMContext';
import { Plus, Trash2, Edit2, Calendar, ArrowLeft } from 'lucide-react';

export default function PMProjectsPage() {
    const { projects, tickets, tags, addProject, updateProject, deleteProject } = usePM();
    const [isCreating, setIsCreating] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

    const [name, setName] = useState('');
    const [description, setDescription] = useState('');

    const handleCreate = (e: React.FormEvent) => {
        e.preventDefault();
        if (name.trim()) {
            addProject({ name: name.trim(), description: description.trim() });
            setName('');
            setDescription('');
            setIsCreating(false);
        }
    };

    const handleUpdate = (e: React.FormEvent) => {
        e.preventDefault();
        if (editingId && name.trim()) {
            updateProject(editingId, { name: name.trim(), description: description.trim() });
            setEditingId(null);
            setName('');
            setDescription('');
        }
    };

    const startEdit = (p: any) => {
        setEditingId(p.id);
        setName(p.name);
        setDescription(p.description || '');
    };

    const getProjectTicketCount = (id: string) => tickets.filter(t => t.projectId === id).length;

    if (selectedProjectId) {
        const project = projects.find(p => p.id === selectedProjectId);
        if (!project) {
            setSelectedProjectId(null);
            return null;
        }

        const projectTickets = tickets.filter(t => t.projectId === project.id);

        return (
            <div className="animate-in fade-in duration-300 max-w-4xl mx-auto">
                <button
                    onClick={() => setSelectedProjectId(null)}
                    className="flex items-center gap-2 text-ink-soft hover:text-ink mb-6 transition-colors"
                >
                    <ArrowLeft className="w-4 h-4" />
                    <span>Back to Projects</span>
                </button>

                <div className="bg-card/50 border border-line rounded-2xl p-8 mb-8">
                    <div className="flex justify-between items-start mb-6">
                        <div>
                            <h1 className="text-3xl font-bold text-ink mb-2">{project.name}</h1>
                            <div className="flex items-center gap-2 text-ink-faint text-sm font-mono">
                                <Calendar className="w-4 h-4" />
                                Created {new Date(project.createdAt).toLocaleDateString()}
                            </div>
                        </div>
                    </div>

                    <div className="prose prose-invert max-w-none">
                        <p className="text-ink-soft text-lg leading-relaxed">{project.description || 'No description provided.'}</p>
                    </div>
                </div>

                <div className="space-y-4">
                    <h2 className="text-xl font-bold text-ink mb-4 flex items-center gap-2">
                        Project Tickets
                        <span className="bg-paper-deep text-ink-soft text-xs py-0.5 px-2 rounded-full font-mono">{projectTickets.length}</span>
                    </h2>

                    {projectTickets.length === 0 ? (
                        <div className="py-12 text-center text-ink-faint border-2 border-dashed border-line rounded-2xl">
                            No tickets in this project yet.
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 gap-3">
                            {projectTickets.map(ticket => {
                                const ticketTags = tags.filter(t => ticket.tagIds.includes(t.id));

                                return (
                                    <div key={ticket.id} className="bg-card border border-line rounded-xl p-4 flex items-center justify-between">
                                        <div>
                                            <h3 className="text-ink font-medium mb-1">{ticket.title}</h3>
                                            <div className="flex items-center gap-3">
                                                <span className="text-xs text-ink-faint font-mono capitalize px-2 py-0.5 bg-paper-deep rounded-md border border-line">
                                                    {ticket.status.replace('_', ' ')}
                                                </span>
                                                <div className="flex flex-wrap gap-1.5">
                                                    {ticketTags.map(tag => (
                                                        <span key={tag.id} className="text-[10px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: `${tag.color}20`, color: tag.color, border: `1px solid ${tag.color}40` }}>
                                                            {tag.name}
                                                        </span>
                                                    ))}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </div>
            </div>
        );
    }

    return (
        <div className="animate-in fade-in duration-300 max-w-4xl mx-auto">
            <div className="flex items-center justify-between mb-8">
                <div>
                    <h1 className="text-3xl font-serif text-ink mb-2">Projects</h1>
                    <p className="text-ink-soft font-mono text-sm tracking-tight">Manage your project workspaces</p>
                </div>
                {!isCreating && !editingId && (
                    <button
                        onClick={() => { setIsCreating(true); setName(''); setDescription(''); }}
                        className="flex items-center gap-2 px-4 py-2 bg-ember text-[#FFF8F2] rounded-xl hover:bg-opacity-90 transition-all font-semibold text-sm shadow-ember"
                    >
                        <Plus className="w-4 h-4" />
                        <span>New Project</span>
                    </button>
                )}
            </div>

            {(isCreating || editingId) && (
                <div className="bg-card border border-line rounded-2xl p-6 mb-8 shadow-xl">
                    <h2 className="text-lg font-bold text-ink mb-4">{editingId ? 'Edit Project' : 'Create New Project'}</h2>
                    <form onSubmit={editingId ? handleUpdate : handleCreate} className="space-y-4">
                        <div>
                            <label className="block text-xs font-semibold text-ink-soft uppercase tracking-wider mb-2">Project Name</label>
                            <input
                                autoFocus
                                value={name}
                                onChange={e => setName(e.target.value)}
                                placeholder="e.g. Chunk Analytics V2"
                                className="w-full px-4 py-2 bg-paper-deep border border-line rounded-xl focus:outline-none focus:border-lake text-ink transition-colors"
                                required
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-semibold text-ink-soft uppercase tracking-wider mb-2">Description (Optional)</label>
                            <textarea
                                value={description}
                                onChange={e => setDescription(e.target.value)}
                                placeholder="Briefly describe this project..."
                                rows={3}
                                className="w-full px-4 py-2 bg-paper-deep border border-line rounded-xl focus:outline-none focus:border-lake text-ink transition-colors resize-none"
                            />
                        </div>
                        <div className="flex justify-end gap-3 pt-2">
                            <button
                                type="button"
                                onClick={() => { setIsCreating(false); setEditingId(null); }}
                                className="px-4 py-2 text-sm text-ink-soft hover:text-ink transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                disabled={!name.trim()}
                                className="px-6 py-2 text-sm bg-ember text-[#FFF8F2] rounded-xl hover:bg-opacity-90 transition-all font-semibold disabled:opacity-50"
                            >
                                {editingId ? 'Save Changes' : 'Create Project'}
                            </button>
                        </div>
                    </form>
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {projects.length === 0 && !isCreating ? (
                    <div className="col-span-full py-12 text-center text-ink-faint border-2 border-dashed border-line rounded-2xl">
                        No projects found. Create one to get started.
                    </div>
                ) : (
                    projects.map(p => (
                        <div
                            key={p.id}
                            onClick={() => setSelectedProjectId(p.id)}
                            className="bg-card/50 border border-line hover:border-line rounded-2xl p-6 transition-colors group cursor-pointer"
                        >
                            <div className="flex justify-between items-start mb-4">
                                <h3 className="text-lg font-bold text-ink group-hover:text-accent transition-colors">{p.name}</h3>
                                <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button
                                        onClick={(e) => { e.stopPropagation(); startEdit(p); }}
                                        className="p-1.5 text-ink-soft hover:text-ink hover:bg-paper-deep rounded-lg"
                                    >
                                        <Edit2 className="w-4 h-4" />
                                    </button>
                                    <button
                                        onClick={(e) => { e.stopPropagation(); deleteProject(p.id); }}
                                        className="p-1.5 text-ember-deep hover:text-ink hover:bg-red-500/20 rounded-lg"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>
                            <p className="text-ink-soft text-sm mb-6 min-h-[40px]">{p.description || 'No description provided.'}</p>

                            <div className="flex items-center justify-between text-xs text-ink-faint font-mono">
                                <div className="flex items-center gap-1.5">
                                    <span className="w-2 h-2 rounded-full bg-accent"></span>
                                    {getProjectTicketCount(p.id)} Tickets
                                </div>
                                <div className="flex items-center gap-1.5">
                                    <Calendar className="w-3.5 h-3.5" />
                                    {new Date(p.createdAt).toLocaleDateString()}
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
