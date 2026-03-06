import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

const MASTER_DOC_PATH = 'chunk_pm_data/master';

export async function GET() {
    try {
        const [projectsSnap, tagsSnap, ticketsSnap] = await Promise.all([
            adminDb.collection(`${MASTER_DOC_PATH}/projects`).get(),
            adminDb.collection(`${MASTER_DOC_PATH}/tags`).get(),
            adminDb.collection(`${MASTER_DOC_PATH}/tickets`).get()
        ]);

        const projects = projectsSnap.docs.map(d => d.data());
        const tags = tagsSnap.docs.map(d => d.data());
        const tickets = ticketsSnap.docs.map(d => d.data());

        return NextResponse.json(
            { projects, tags, tickets },
            { headers: { 'Cache-Control': 'no-store, max-age=0' } }
        );
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
            await adminDb.collection(`${MASTER_DOC_PATH}/${colName}`).doc(id).set(payload, { merge: merge || false });
            return NextResponse.json({ success: true });
        }

        if (action === 'deleteDoc') {
            const { collection: colName, id } = data;
            await adminDb.collection(`${MASTER_DOC_PATH}/${colName}`).doc(id).delete();
            return NextResponse.json({ success: true });
        }

        if (action === 'writeBatch') {
            const { operations } = data; // Array of { type: 'set'|'update'|'delete', collection: string, id: string, payload?: any }
            const batch = adminDb.batch();
            for (const op of operations) {
                const ref = adminDb.collection(`${MASTER_DOC_PATH}/${op.collection}`).doc(op.id);
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
