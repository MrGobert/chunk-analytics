import * as admin from 'firebase-admin';

if (!admin.apps.length) {
    const projectId = process.env.GCP_PROJECT_ID;
    const credentialsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS;

    if (!projectId) {
        console.error('[Firebase Admin] GCP_PROJECT_ID is not set — Firestore will not work');
    }

    if (credentialsJson) {
        try {
            const serviceAccount = JSON.parse(credentialsJson);
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount),
                projectId,
            });
            console.log('[Firebase Admin] Initialized with service account');
        } catch (e) {
            console.error('[Firebase Admin] Failed to parse GOOGLE_APPLICATION_CREDENTIALS:', e);
            // Initialize without explicit credentials as last resort (works in GCP-hosted envs)
            admin.initializeApp({ projectId });
            console.warn('[Firebase Admin] Falling back to Application Default Credentials');
        }
    } else {
        console.warn('[Firebase Admin] No GOOGLE_APPLICATION_CREDENTIALS — using ADC fallback');
        admin.initializeApp({ projectId });
    }
}

export const adminDb = admin.firestore();
