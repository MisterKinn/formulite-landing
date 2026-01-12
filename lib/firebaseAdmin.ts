import admin from "firebase-admin";

// Initialize Firebase Admin SDK using one of possible env vars
const initAdmin = () => {
    if (admin.apps && admin.apps.length > 0) return admin;

    // Prefer GOOGLE_APPLICATION_CREDENTIALS path or FIREBASE_ADMIN_CREDENTIALS JSON
    const serviceAccountPath =
        process.env.GOOGLE_APPLICATION_CREDENTIALS || undefined;
    const serviceAccountJson =
        process.env.FIREBASE_ADMIN_CREDENTIALS || undefined;

    try {
        if (serviceAccountPath) {
            admin.initializeApp({
                credential: admin.credential.applicationDefault(),
            });
        } else if (serviceAccountJson) {
            const parsed = JSON.parse(serviceAccountJson);
            admin.initializeApp({
                credential: admin.credential.cert(parsed),
            });
        } else {
            // Try default
            admin.initializeApp({
                credential: admin.credential.applicationDefault(),
            });
        }
    } catch (err) {
        // If initialization failed, rethrow with hint
        console.error("[firebaseAdmin] Failed to initialize admin", err);
        throw err;
    }
    return admin;
};

export default initAdmin();
