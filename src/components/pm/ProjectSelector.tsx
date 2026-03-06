'use client';

import { useState } from 'react';
import { usePM } from '@/store/PMContext';
import { ChevronDown, Plus, FolderOpen } from 'lucide-react';

export default function ProjectSelector() {
    const { projects, activeProjectId, setActiveProject, addProject } = usePM();
    const [isOpen, setIsOpen] = useState(false);
    const [isCreating, setIsCreating] = useState(false);
    const [newProjectName, setNewProjectName] = useState('');

    const activeProject = projects.find((p) => p.id === activeProjectId);

    const handleCreate = (e: React.FormEvent) => {
        e.preventDefault();
        if (newProjectName.trim()) {
            addProject({ name: newProjectName.trim(), description: '' });
            setNewProjectName('');
            setIsCreating(false);
            setIsOpen(false);
        }
    };

    return (
        <div className="relative z-50">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="flex items-center gap-2 px-4 py-2 bg-primary border border-white/10 rounded-xl hover:bg-primary-hover transition-colors"
            >
                <FolderOpen className="w-4 h-4 text-accent" />
                <span className="font-semibold text-sm">
                    {activeProject ? activeProject.name : 'Select a Project'}
                </span>
                <ChevronDown className={`w-4 h-4 text-zinc-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </button>

            {isOpen && (
                <div className="absolute top-full mt-2 right-0 w-64 bg-primary border border-white/10 rounded-xl shadow-2xl overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
                    <div className="max-h-60 overflow-y-auto p-2 space-y-1">
                        {projects.length === 0 ? (
                            <div className="px-3 py-4 text-center text-zinc-500 text-sm">No projects yet</div>
                        ) : (
                            projects.map((p) => (
                                <button
                                    key={p.id}
                                    onClick={() => { setActiveProject(p.id); setIsOpen(false); }}
                                    className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${activeProjectId === p.id ? 'bg-white/10 text-white' : 'text-zinc-400 hover:bg-white/5 hover:text-white'
                                        }`}
                                >
                                    {p.name}
                                </button>
                            ))
                        )}
                    </div>

                    <div className="p-2 border-t border-white/10 bg-black/20">
                        {isCreating ? (
                            <form onSubmit={handleCreate} className="flex flex-col gap-2">
                                <input
                                    autoFocus
                                    type="text"
                                    placeholder="Project name..."
                                    value={newProjectName}
                                    onChange={(e) => setNewProjectName(e.target.value)}
                                    className="w-full px-3 py-1.5 text-sm bg-black/40 border border-white/10 rounded-lg focus:outline-none focus:border-accent text-white"
                                />
                                <div className="flex justify-end gap-2">
                                    <button type="button" onClick={() => setIsCreating(false)} className="px-2 py-1 text-xs text-zinc-400 hover:text-white">Cancel</button>
                                    <button type="submit" disabled={!newProjectName.trim()} className="px-2 py-1 text-xs bg-accent text-white rounded hover:bg-opacity-80 disabled:opacity-50">Create</button>
                                </div>
                            </form>
                        ) : (
                            <button
                                onClick={() => setIsCreating(true)}
                                className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm text-accent hover:bg-accent/10 rounded-lg transition-colors"
                            >
                                <Plus className="w-4 h-4" />
                                <span>New Project</span>
                            </button>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
