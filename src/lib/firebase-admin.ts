import * as admin from 'firebase-admin';

if (!admin.apps.length) {
    let credential;

    // First try explicit service account JSON
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        try {
            const serviceAccount = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS);
            credential = admin.credential.cert(serviceAccount);
            console.log('[Firebase Admin] Initialized via GOOGLE_APPLICATION_CREDENTIALS');
        } catch (e) {
            console.error('[Firebase Admin] Failed to parse GOOGLE_APPLICATION_CREDENTIALS', e);
        }
    }
    // Fallback to API keys (Since we just rely on default credentials for this project usually)
    // Actually, Admin SDK requires a service account for firestore. Let's see if default Application Default Credentials work.

    if (!credential) {
        try {
            admin.initializeApp({
                projectId: process.env.GCP_PROJECT_ID,
            });
            console.log('[Firebase Admin] Initialized via Application Default Credentials');
        } catch (e) {
            console.error('[Firebase Admin] Init failed', e);
        }
    } else {
        admin.initializeApp({
            credential,
            projectId: process.env.GCP_PROJECT_ID,
        });
    }
}

export const adminDb = admin.firestore();
