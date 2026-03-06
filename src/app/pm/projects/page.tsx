'use client';

import { useState } from 'react';
import { usePM } from '@/store/PMContext';
import { Plus, Trash2, Edit2, Calendar } from 'lucide-react';

export default function PMProjectsPage() {
    const { projects, tickets, addProject, updateProject, deleteProject } = usePM();
    const [isCreating, setIsCreating] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);

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

    return (
        <div className="animate-in fade-in duration-300 max-w-4xl mx-auto">
            <div className="flex items-center justify-between mb-8">
                <div>
                    <h1 className="text-3xl font-serif text-white mb-2">Projects</h1>
                    <p className="text-zinc-400 font-mono text-sm tracking-tight">Manage your project workspaces</p>
                </div>
                {!isCreating && !editingId && (
                    <button
                        onClick={() => { setIsCreating(true); setName(''); setDescription(''); }}
                        className="flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-xl hover:bg-opacity-90 transition-all font-semibold text-sm shadow-[0_0_15px_var(--accent-glow)]"
                    >
                        <Plus className="w-4 h-4" />
                        <span>New Project</span>
                    </button>
                )}
            </div>

            {(isCreating || editingId) && (
                <div className="bg-primary border border-white/10 rounded-2xl p-6 mb-8 shadow-xl">
                    <h2 className="text-lg font-bold text-white mb-4">{editingId ? 'Edit Project' : 'Create New Project'}</h2>
                    <form onSubmit={editingId ? handleUpdate : handleCreate} className="space-y-4">
                        <div>
                            <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">Project Name</label>
                            <input
                                autoFocus
                                value={name}
                                onChange={e => setName(e.target.value)}
                                placeholder="e.g. Chunk Analytics V2"
                                className="w-full px-4 py-2 bg-black/40 border border-white/10 rounded-xl focus:outline-none focus:border-accent text-white transition-colors"
                                required
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">Description (Optional)</label>
                            <textarea
                                value={description}
                                onChange={e => setDescription(e.target.value)}
                                placeholder="Briefly describe this project..."
                                rows={3}
                                className="w-full px-4 py-2 bg-black/40 border border-white/10 rounded-xl focus:outline-none focus:border-accent text-white transition-colors resize-none"
                            />
                        </div>
                        <div className="flex justify-end gap-3 pt-2">
                            <button
                                type="button"
                                onClick={() => { setIsCreating(false); setEditingId(null); }}
                                className="px-4 py-2 text-sm text-zinc-400 hover:text-white transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                disabled={!name.trim()}
                                className="px-6 py-2 text-sm bg-accent text-white rounded-xl hover:bg-opacity-90 transition-all font-semibold disabled:opacity-50"
                            >
                                {editingId ? 'Save Changes' : 'Create Project'}
                            </button>
                        </div>
                    </form>
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {projects.length === 0 && !isCreating ? (
                    <div className="col-span-full py-12 text-center text-zinc-500 border-2 border-dashed border-white/5 rounded-2xl">
                        No projects found. Create one to get started.
                    </div>
                ) : (
                    projects.map(p => (
                        <div key={p.id} className="bg-primary/50 border border-white/5 hover:border-white/10 rounded-2xl p-6 transition-colors group">
                            <div className="flex justify-between items-start mb-4">
                                <h3 className="text-lg font-bold text-white">{p.name}</h3>
                                <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button onClick={() => startEdit(p)} className="p-1.5 text-zinc-400 hover:text-white hover:bg-white/10 rounded-lg">
                                        <Edit2 className="w-4 h-4" />
                                    </button>
                                    <button onClick={() => deleteProject(p.id)} className="p-1.5 text-red-500 hover:text-white hover:bg-red-500/20 rounded-lg">
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>
                            <p className="text-zinc-400 text-sm mb-6 min-h-[40px]">{p.description || 'No description provided.'}</p>

                            <div className="flex items-center justify-between text-xs text-zinc-500 font-mono">
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
