import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { collection, doc, getDocs, setDoc, deleteDoc, writeBatch } from 'firebase/firestore';

const MASTER_DOC_PATH = 'chunk_pm_data/master';

export async function GET() {
    try {
        const [projectsSnap, tagsSnap, ticketsSnap] = await Promise.all([
            getDocs(collection(db, `${MASTER_DOC_PATH}/projects`)),
            getDocs(collection(db, `${MASTER_DOC_PATH}/tags`)),
            getDocs(collection(db, `${MASTER_DOC_PATH}/tickets`))
        ]);

        const projects = projectsSnap.docs.map(d => d.data());
        const tags = tagsSnap.docs.map(d => d.data());
        const tickets = ticketsSnap.docs.map(d => d.data());

        return NextResponse.json({ projects, tags, tickets });
    } catch (e: any) {
        console.error("Error fetching PM data from Firestore:", e);
        return NextResponse.json({ error: e.message || 'Failed to fetch PM Data' }, { status: 500 });
    }
}

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const { action, data } = body;

        if (action === 'setDoc') {
            const { collection: colName, id, payload, merge } = data;
            await setDoc(doc(db, `${MASTER_DOC_PATH}/${colName}`, id), payload, { merge: merge || false });
            return NextResponse.json({ success: true });
        }

        if (action === 'deleteDoc') {
            const { collection: colName, id } = data;
            await deleteDoc(doc(db, `${MASTER_DOC_PATH}/${colName}`, id));
            return NextResponse.json({ success: true });
        }

        if (action === 'writeBatch') {
            const { operations } = data; // Array of { type: 'set'|'update'|'delete', collection: string, id: string, payload?: any }
            const batch = writeBatch(db);
            for (const op of operations) {
                const ref = doc(db, `${MASTER_DOC_PATH}/${op.collection}`, op.id);
                if (op.type === 'set') batch.set(ref, op.payload);
                if (op.type === 'update') batch.update(ref, op.payload);
                if (op.type === 'delete') batch.delete(ref);
            }
            await batch.commit();
            return NextResponse.json({ success: true });
        }

        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    } catch (e: any) {
        console.error("Error syncing PM data to Firestore:", e);
        return NextResponse.json({ error: e.message || 'Internal sync error' }, { status: 500 });
    }
}
