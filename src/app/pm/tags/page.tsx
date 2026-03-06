'use client';

import { useState } from 'react';
import { usePM, Tag } from '@/store/PMContext';
import { Plus, Trash2, Edit2, Tag as TagIcon } from 'lucide-react';

const PRESET_COLORS = [
    '#ef4444', '#f97316', '#f59e0b', '#84cc16', '#10b981', '#14b8a6',
    '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6', '#d946ef', '#f43f5e'
];

export default function PMTagsPage() {
    const { tags, addTag, updateTag, deleteTag } = usePM();
    const [isCreating, setIsCreating] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);

    const [name, setName] = useState('');
    const [color, setColor] = useState(PRESET_COLORS[0]);

    const handleCreate = (e: React.FormEvent) => {
        e.preventDefault();
        if (name.trim()) {
            addTag({ name: name.trim(), color });
            setName('');
            setColor(PRESET_COLORS[0]);
            setIsCreating(false);
        }
    };

    const handleUpdate = (e: React.FormEvent) => {
        e.preventDefault();
        if (editingId && name.trim()) {
            updateTag(editingId, { name: name.trim(), color });
            setEditingId(null);
            setName('');
            setColor(PRESET_COLORS[0]);
        }
    };

    const startEdit = (t: Tag) => {
        setEditingId(t.id);
        setName(t.name);
        setColor(t.color);
    };

    return (
        <div className="animate-in fade-in duration-300 max-w-4xl mx-auto">
            <div className="flex items-center justify-between mb-8">
                <div>
                    <h1 className="text-3xl font-serif text-white mb-2">Labels & Tags</h1>
                    <p className="text-zinc-400 font-mono text-sm tracking-tight">Organize tickets with customizable labels</p>
                </div>
                {!isCreating && !editingId && (
                    <button
                        onClick={() => { setIsCreating(true); setName(''); setColor(PRESET_COLORS[0]); }}
                        className="flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-xl hover:bg-opacity-90 transition-all font-semibold text-sm shadow-[0_0_15px_var(--accent-glow)]"
                    >
                        <Plus className="w-4 h-4" />
                        <span>New Tag</span>
                    </button>
                )}
            </div>

            {(isCreating || editingId) && (
                <div className="bg-primary border border-white/10 rounded-2xl p-6 mb-8 shadow-xl">
                    <h2 className="text-lg font-bold text-white mb-4">{editingId ? 'Edit Tag' : 'Create New Tag'}</h2>
                    <form onSubmit={editingId ? handleUpdate : handleCreate} className="space-y-6">
                        <div>
                            <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">Tag Name</label>
                            <input
                                autoFocus
                                value={name}
                                onChange={e => setName(e.target.value)}
                                placeholder="e.g. Bug, Feature, Urgent"
                                className="w-full px-4 py-2.5 bg-black/40 border border-white/10 rounded-xl focus:outline-none focus:border-accent text-white transition-colors"
                                required
                            />
                        </div>

                        <div>
                            <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">Color</label>
                            <div className="flex flex-wrap gap-3">
                                {PRESET_COLORS.map(c => (
                                    <button
                                        key={c}
                                        type="button"
                                        onClick={() => setColor(c)}
                                        className={`w-10 h-10 rounded-full transition-transform ${color === c ? 'scale-125 ring-2 ring-white ring-offset-2 ring-offset-black' : 'hover:scale-110'}`}
                                        style={{ backgroundColor: c }}
                                    />
                                ))}
                            </div>
                        </div>

                        <div className="flex items-center justify-between pt-4 border-t border-white/5">
                            <div className="flex items-center gap-3">
                                <span className="text-sm text-zinc-500">Preview:</span>
                                <span className="text-xs uppercase tracking-wider font-bold px-2.5 py-1 rounded" style={{ backgroundColor: `${color}20`, color: color, border: `1px solid ${color}40` }}>
                                    {name || 'Tag Name'}
                                </span>
                            </div>
                            <div className="flex items-center gap-3">
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
                                    {editingId ? 'Save Changes' : 'Create Tag'}
                                </button>
                            </div>
                        </div>
                    </form>
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {tags.length === 0 && !isCreating ? (
                    <div className="col-span-full py-12 text-center text-zinc-500 border-2 border-dashed border-white/5 rounded-2xl">
                        No tags found. Create one to get started.
                    </div>
                ) : (
                    tags.map(t => (
                        <div key={t.id} className="bg-primary/50 border border-white/5 hover:border-white/10 rounded-xl p-4 flex items-center justify-between group transition-colors">
                            <div className="flex items-center gap-3">
                                <TagIcon className="w-4 h-4" style={{ color: t.color }} />
                                <span className="text-sm uppercase tracking-wider font-bold px-2 py-0.5 rounded" style={{ backgroundColor: `${t.color}20`, color: t.color, border: `1px solid ${t.color}40` }}>
                                    {t.name}
                                </span>
                            </div>
                            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button onClick={() => startEdit(t)} className="p-1.5 text-zinc-400 hover:text-white hover:bg-white/10 rounded-lg">
                                    <Edit2 className="w-4 h-4" />
                                </button>
                                <button onClick={() => deleteTag(t.id)} className="p-1.5 text-red-500 hover:text-white hover:bg-red-500/20 rounded-lg">
                                    <Trash2 className="w-4 h-4" />
                                </button>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
