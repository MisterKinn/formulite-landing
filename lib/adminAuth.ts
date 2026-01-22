import admin from "firebase-admin";

// Initialize admin SDK once
if (!admin.apps.length) {
    if (process.env.FIREBASE_ADMIN_CREDENTIALS) {
        try {
            const creds = JSON.parse(process.env.FIREBASE_ADMIN_CREDENTIALS);
            admin.initializeApp({ credential: admin.credential.cert(creds) });
        } catch (err) {
            console.error("Failed to parse FIREBASE_ADMIN_CREDENTIALS", err);
            admin.initializeApp();
        }
    } else {
        admin.initializeApp();
    }
}

// Admin email whitelist
const ADMIN_EMAILS = ["kinn@kinn.kr"];

export interface AdminUser {
    uid: string;
    email: string;
}

/**
 * Verify if the request is from an admin user
 * Returns the admin user info if valid, null otherwise
 */
export async function verifyAdmin(
    authHeader: string | null,
): Promise<AdminUser | null> {
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return null;
    }

    const token = authHeader.split("Bearer ")[1];

    try {
        const decodedToken = await admin.auth().verifyIdToken(token);
        const email = decodedToken.email;

        if (!email || !ADMIN_EMAILS.includes(email)) {
            return null;
        }

        return {
            uid: decodedToken.uid,
            email: email,
        };
    } catch (err) {
        console.error("Admin token verification failed:", err);
        return null;
    }
}

/**
 * Check if an email is an admin email
 */
export function isAdminEmail(email: string | null | undefined): boolean {
    return !!email && ADMIN_EMAILS.includes(email);
}

export { admin };
