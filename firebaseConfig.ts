import { FirebaseApp, getApps, initializeApp } from "firebase/app";

type FirebaseClientConfig = {
    apiKey?: string;
    authDomain?: string;
    projectId?: string;
    storageBucket?: string;
    messagingSenderId?: string;
    appId?: string;
    measurementId?: string;
};

// Firebase configuration from environment variables (client-side).
const firebaseConfig: FirebaseClientConfig = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
    measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
};

const REQUIRED_KEYS: (keyof FirebaseClientConfig)[] = [
    "apiKey",
    "authDomain",
    "projectId",
    "storageBucket",
    "messagingSenderId",
    "appId",
];

const missingRequiredKeys = REQUIRED_KEYS.filter((k) => !firebaseConfig[k]);

export function isFirebaseConfigured(): boolean {
    return missingRequiredKeys.length === 0;
}

export function getFirebaseClientConfigDiagnostics() {
    return {
        configured: isFirebaseConfigured(),
        missingRequiredKeys: [...missingRequiredKeys],
        projectId: firebaseConfig.projectId || null,
        authDomain: firebaseConfig.authDomain || null,
    };
}

/**
 * Returns the initialized Firebase App, or throws if required env vars are missing.
 *
 * NOTE: We intentionally do NOT initialize at module-load time because missing
 * env vars would crash the whole Next.js app on the client.
 */
export function getFirebaseApp(): FirebaseApp {
    if (!isFirebaseConfigured()) {
        throw new Error(
            `Firebase client env is missing: ${missingRequiredKeys.join(", ")}`,
        );
    }

    const existing = getApps();
    if (existing.length > 0) return existing[0]!;

    return initializeApp(firebaseConfig as any);
}

/**
 * Safe accessor that returns null when Firebase isn't configured.
 * Use this in UI code paths where you prefer graceful degradation.
 */
export function getFirebaseAppOrNull(): FirebaseApp | null {
    try {
        return getFirebaseApp();
    } catch (err) {
        // Warn in browser only (avoid noisy server logs during build/compile).
        if (typeof window !== "undefined") {
            try {
                console.warn(
                    "[firebaseConfig] Firebase not configured; auth features disabled.",
                    err,
                );
            } catch {
                // ignore logging failures
            }
        }
        return null;
    }
}

// Backwards-compatible export. Prefer `getFirebaseApp()` / `getFirebaseAppOrNull()`.
export const app: FirebaseApp | null = getFirebaseAppOrNull();
