import admin from "firebase-admin";

/**
 * getFirebaseAdmin
 * Lazily initialize and return the firebase-admin namespace.
 * Throws a clear error if admin credentials are not available or invalid.
 *
 * Supported initialization methods (in order):
 * 1) FIREBASE_ADMIN_CREDENTIALS (JSON string) - recommended for environment vars
 * 2) GOOGLE_APPLICATION_CREDENTIALS (path to service account JSON) + applicationDefault()
 * 3) Google Application Default Credentials (e.g. `gcloud auth application-default login` in dev)
 *
 * Security: Do NOT commit service account JSON to source control. Use environment variables or secret management.
 */
export default function getFirebaseAdmin() {
    if (admin.apps && admin.apps.length > 0) return admin;

    const serviceAccountJson = process.env.FIREBASE_ADMIN_CREDENTIALS;
    const serviceAccountB64 = process.env.FIREBASE_ADMIN_CREDENTIALS_B64;
    const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;

    try {
        if (serviceAccountJson) {
            // Prefer an explicit JSON string in env (useful on platforms that allow secret JSON)
            const parsed = JSON.parse(serviceAccountJson);
            admin.initializeApp({ credential: admin.credential.cert(parsed) });
        } else if (serviceAccountB64) {
            // Some platforms (or CI) prefer providing base64-encoded JSON
            const json = Buffer.from(serviceAccountB64, "base64").toString(
                "utf8"
            );
            const parsed = JSON.parse(json);
            admin.initializeApp({ credential: admin.credential.cert(parsed) });
        } else {
            // Otherwise try application default credentials (may pick up GOOGLE_APPLICATION_CREDENTIALS path or ADC)
            admin.initializeApp({
                credential: admin.credential.applicationDefault(),
            });
        }

        // Log detected projectId for easier diagnostics (non-sensitive)
        try {
            const projectId =
                admin?.app()?.options?.projectId ||
                process.env.FIREBASE_PROJECT_ID ||
                process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
                null;
            console.info("[firebaseAdmin] initialized", { projectId });
        } catch (logErr) {
            console.warn("[firebaseAdmin] could not read projectId", logErr);
        }

        return admin;
    } catch (err) {
        console.error(
            "[firebaseAdmin] Initialization failed. Ensure FIREBASE_ADMIN_CREDENTIALS (JSON) or GOOGLE_APPLICATION_CREDENTIALS is set. See https://cloud.google.com/docs/authentication/getting-started",
            err
        );
        const e = new Error(
            "Firebase Admin initialization failed: missing or invalid credentials. Set FIREBASE_ADMIN_CREDENTIALS (JSON) or GOOGLE_APPLICATION_CREDENTIALS (path) and restart."
        );
        (e as any).original = err;
        throw e;
    }
}
