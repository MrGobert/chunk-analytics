'use client';

import ProjectSelector from '@/components/pm/ProjectSelector';
import Board from '@/components/pm/Board';

export default function PMBoardPage() {
    return (
        <div className="animate-in fade-in duration-300 h-full flex flex-col">
            <div className="flex items-center justify-between mb-8">
                <div>
                    <h1 className="text-3xl font-serif text-white mb-2">Kanban Board</h1>
                    <p className="text-zinc-400 font-mono text-sm tracking-tight">Organize tasks and track progress</p>
                </div>
                <ProjectSelector />
            </div>

            <Board />
        </div>
    );
}
