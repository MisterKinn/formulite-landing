import crypto from "crypto";
import { ADMIN_EMAILS, ADMIN_EMAIL } from "@/lib/adminPortal";
import getFirebaseAdmin from "@/lib/firebaseAdmin";

const admin = getFirebaseAdmin();

const ADMIN_SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12 hours
const ADMIN_TOKEN_VERSION = 1;

export interface AdminUser {
    uid: string;
    email: string;
    provider?: "firebase" | "portal";
}

interface AdminSessionPayload {
    v: number;
    type: "admin-portal";
    email: string;
    iat: number;
    exp: number;
}

function getAdminSessionSecret() {
    return (
        process.env.ADMIN_PORTAL_SECRET ||
        process.env.ADMIN_SECRET ||
        "nova-admin-session-secret-change-me"
    );
}

function base64UrlEncode(input: string) {
    return Buffer.from(input, "utf8").toString("base64url");
}

function base64UrlDecode(input: string) {
    return Buffer.from(input, "base64url").toString("utf8");
}

function signAdminPayload(encodedPayload: string) {
    return crypto
        .createHmac("sha256", getAdminSessionSecret())
        .update(encodedPayload)
        .digest("base64url");
}

function safeCompare(a: string, b: string) {
    try {
        const aBuf = Buffer.from(a);
        const bBuf = Buffer.from(b);
        if (aBuf.length !== bBuf.length) return false;
        return crypto.timingSafeEqual(aBuf, bBuf);
    } catch {
        return false;
    }
}

export function createAdminSessionToken() {
    const now = Date.now();
    const payload: AdminSessionPayload = {
        v: ADMIN_TOKEN_VERSION,
        type: "admin-portal",
        email: ADMIN_EMAIL,
        iat: now,
        exp: now + ADMIN_SESSION_TTL_MS,
    };
    const encodedPayload = base64UrlEncode(JSON.stringify(payload));
    const signature = signAdminPayload(encodedPayload);
    return `${encodedPayload}.${signature}`;
}

export function verifyAdminSessionToken(token: string): AdminUser | null {
    const parts = token.split(".");
    if (parts.length !== 2) return null;
    const [encodedPayload, signature] = parts;
    const expectedSignature = signAdminPayload(encodedPayload);
    if (!safeCompare(signature, expectedSignature)) return null;

    try {
        const payload = JSON.parse(
            base64UrlDecode(encodedPayload),
        ) as AdminSessionPayload;
        if (payload.v !== ADMIN_TOKEN_VERSION) return null;
        if (payload.type !== "admin-portal") return null;
        if (!payload.email || !ADMIN_EMAILS.includes(payload.email)) return null;
        if (!payload.exp || payload.exp < Date.now()) return null;
        return {
            uid: "admin-portal",
            email: payload.email,
            provider: "portal",
        };
    } catch {
        return null;
    }
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

    const portalAdmin = verifyAdminSessionToken(token);
    if (portalAdmin) {
        return portalAdmin;
    }

    try {
        const decodedToken = await admin.auth().verifyIdToken(token);
        const email = decodedToken.email?.toLowerCase();

        if (!email || !ADMIN_EMAILS.includes(email)) {
            return null;
        }

        return {
            uid: decodedToken.uid,
            email: email,
            provider: "firebase",
        };
    } catch {
        return null;
    }
}

/**
 * Check if an email is an admin email
 */
export function isAdminEmail(email: string | null | undefined): boolean {
    return !!email && ADMIN_EMAILS.includes(email.toLowerCase());
}

export { admin };
