'use client';

import { useState } from 'react';
import { usePM, TicketStatus, Attachment } from '@/store/PMContext';
import { X, Paperclip, Link as LinkIcon, Trash2, File as FileIcon } from 'lucide-react';

interface TicketModalProps {
    ticketId: string | null;
    initialStatus?: TicketStatus;
    onClose: () => void;
}

export default function TicketModal({ ticketId, initialStatus, onClose }: TicketModalProps) {
    const { tickets, activeProjectId, tags, addTicket, updateTicket, deleteTicket } = usePM();
    const existingTicket = ticketId ? tickets.find(t => t.id === ticketId) : null;

    const [title, setTitle] = useState(existingTicket?.title || '');
    const [description, setDescription] = useState(existingTicket?.description || '');
    const [status, setStatus] = useState<TicketStatus>(existingTicket?.status || initialStatus || 'todo');
    const [selectedTags, setSelectedTags] = useState<string[]>(existingTicket?.tagIds || []);
    const [attachments, setAttachments] = useState<Attachment[]>(existingTicket?.attachments || []);

    const [isAddingLink, setIsAddingLink] = useState(false);
    const [linkUrl, setLinkUrl] = useState('');
    const [linkName, setLinkName] = useState('');

    const handleSave = () => {
        if (!title.trim() || !activeProjectId) return;

        if (existingTicket) {
            updateTicket(existingTicket.id, { title, description, status, tagIds: selectedTags, attachments });
        } else {
            addTicket({
                projectId: activeProjectId,
                title,
                description,
                status,
                tagIds: selectedTags,
                attachments
            });
        }
        onClose();
    };

    const handleDelete = () => {
        if (existingTicket) {
            deleteTicket(existingTicket.id);
            onClose();
        }
    };

    const toggleTag = (id: string) => {
        setSelectedTags(prev => prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id]);
    };

    const handleAddLink = () => {
        if (linkUrl.trim()) {
            setAttachments(prev => [...prev, {
                id: crypto.randomUUID(),
                name: linkName.trim() || linkUrl.trim(),
                url: linkUrl.trim(),
                type: 'link'
            }]);
            setIsAddingLink(false);
            setLinkUrl('');
            setLinkName('');
        }
    };

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        // Limit to 2MB to prevent localstorage issues
        if (file.size > 2 * 1024 * 1024) {
            alert('File is too large. Please select a file under 2MB.');
            return;
        }

        const reader = new FileReader();
        reader.onload = (event) => {
            const base64Str = event.target?.result as string;
            setAttachments(prev => [...prev, {
                id: crypto.randomUUID(),
                name: file.name,
                url: base64Str,
                type: 'file'
            }]);
        };
        reader.readAsDataURL(file);
    };

    const removeAttachment = (id: string) => {
        setAttachments(prev => prev.filter(a => a.id !== id));
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-primary border border-white/10 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
                <div className="flex items-center justify-between p-4 border-b border-white/10">
                    <h2 className="text-lg font-semibold text-white">{existingTicket ? 'Edit Ticket' : 'New Ticket'}</h2>
                    <button onClick={onClose} className="p-1.5 text-zinc-400 hover:text-white rounded-lg hover:bg-white/5 transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="p-6 overflow-y-auto space-y-6 flex-1">
                    <div className="space-y-2">
                        <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Title</label>
                        <input
                            autoFocus
                            value={title}
                            onChange={e => setTitle(e.target.value)}
                            onKeyDown={e => {
                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                    document.getElementById('ticket-desc')?.focus();
                                }
                            }}
                            placeholder="What needs to be done?"
                            className="w-full px-4 py-2.5 bg-black/40 border border-white/10 rounded-xl focus:outline-none focus:border-accent text-white transition-colors"
                        />
                    </div>

                    <div className="space-y-2">
                        <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Description</label>
                        <textarea
                            id="ticket-desc"
                            value={description}
                            onChange={e => setDescription(e.target.value)}
                            placeholder="Add more details..."
                            rows={4}
                            className="w-full px-4 py-2.5 bg-black/40 border border-white/10 rounded-xl focus:outline-none focus:border-accent text-white transition-colors resize-none"
                        />
                    </div>

                    <div className="space-y-3">
                        <div className="flex items-center justify-between">
                            <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Attachments</label>
                            <div className="flex items-center gap-2">
                                <button onClick={() => setIsAddingLink(!isAddingLink)} className="flex items-center gap-1 px-2 py-1 text-xs bg-white/5 hover:bg-white/10 rounded text-zinc-300 transition-colors">
                                    <LinkIcon className="w-3 h-3" /> URL
                                </button>
                                <label className="flex items-center gap-1 px-2 py-1 text-xs bg-white/5 hover:bg-white/10 rounded text-zinc-300 transition-colors cursor-pointer">
                                    <Paperclip className="w-3 h-3" /> File
                                    <input type="file" className="hidden" onChange={handleFileUpload} />
                                </label>
                            </div>
                        </div>

                        {isAddingLink && (
                            <div className="flex gap-2 p-3 bg-black/40 border border-white/5 rounded-lg">
                                <input value={linkName} onChange={e => setLinkName(e.target.value)} placeholder="Display Text (optional)" className="flex-1 min-w-[100px] px-2 py-1 text-sm bg-black/40 border border-white/10 rounded focus:border-accent outline-none text-white" />
                                <input autoFocus value={linkUrl} onChange={e => setLinkUrl(e.target.value)} placeholder="https://..." className="flex-2 w-full px-2 py-1 text-sm bg-black/40 border border-white/10 rounded focus:border-accent outline-none text-white" onKeyDown={(e) => e.key === 'Enter' && handleAddLink()} />
                                <button onClick={handleAddLink} className="px-3 py-1 bg-accent text-white text-xs rounded hover:opacity-80 font-bold">Add</button>
                            </div>
                        )}

                        {attachments.length > 0 && (
                            <div className="grid grid-cols-1 gap-2">
                                {attachments.map(att => (
                                    <div key={att.id} className="flex items-center justify-between p-2 bg-white/5 border border-white/5 rounded-lg group">
                                        <a href={att.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 overflow-hidden hover:text-accent transition-colors">
                                            {att.type === 'link' ? <LinkIcon className="w-4 h-4 text-zinc-400 flex-shrink-0" /> : <FileIcon className="w-4 h-4 text-zinc-400 flex-shrink-0" />}
                                            <span className="text-sm text-zinc-200 truncate">{att.name}</span>
                                        </a>
                                        <button onClick={() => removeAttachment(att.id)} className="p-1.5 text-zinc-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all rounded">
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Status</label>
                            <select
                                value={status}
                                onChange={e => setStatus(e.target.value as TicketStatus)}
                                className="w-full px-4 py-2.5 bg-black/40 border border-white/10 rounded-xl focus:outline-none focus:border-accent text-white appearance-none cursor-pointer"
                            >
                                <option value="backlog">Backlog</option>
                                <option value="todo">To Do</option>
                                <option value="in_progress">In Progress</option>
                                <option value="done">Done</option>
                            </select>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Tags</label>
                        {tags.length === 0 ? (
                            <div className="text-sm text-zinc-500 italic">No tags created yet. You can create them in the Tags tab.</div>
                        ) : (
                            <div className="flex flex-wrap gap-2">
                                {tags.map(tag => {
                                    const isSelected = selectedTags.includes(tag.id);
                                    return (
                                        <button
                                            key={tag.id}
                                            onClick={() => toggleTag(tag.id)}
                                            className={`px-3 py-1 rounded-lg text-sm transition-all border ${isSelected ? `border-transparent` : 'bg-transparent border-white/10 opacity-60 hover:opacity-100'
                                                }`}
                                            style={isSelected ? { backgroundColor: tag.color, color: '#fff' } : { color: tag.color, borderColor: `${tag.color}40` }}
                                        >
                                            {tag.name}
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                </div>

                <div className="flex items-center justify-between p-4 border-t border-white/10 bg-black/20">
                    {existingTicket ? (
                        <button onClick={handleDelete} className="px-4 py-2 text-sm text-red-500 hover:bg-red-500/10 rounded-lg transition-colors font-medium">
                            Delete
                        </button>
                    ) : <div></div>}
                    <div className="flex items-center gap-3">
                        <button onClick={onClose} className="px-4 py-2 text-sm text-zinc-400 hover:text-white transition-colors">
                            Cancel
                        </button>
                        <button
                            onClick={handleSave}
                            disabled={!title.trim()}
                            className="px-6 py-2 text-sm bg-accent text-white rounded-lg hover:shadow-[0_0_15px_var(--accent-glow)] transition-all disabled:opacity-50 disabled:hover:shadow-none font-semibold"
                        >
                            Save
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
