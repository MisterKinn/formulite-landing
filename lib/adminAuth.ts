import "server-only";
import crypto from "crypto";
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

function parseValues(rawValue: string | undefined) {
    return Array.from(
        new Set(
            String(rawValue || "")
                .split(/[,\s]+/)
                .map((value) => value.trim())
                .filter(Boolean),
        ),
    );
}

function getAdminEmails() {
    return parseValues(
        process.env.ADMIN_EMAILS ||
            process.env.ADMIN_EMAIL ||
            process.env.NEXT_PUBLIC_ADMIN_EMAILS ||
            process.env.NEXT_PUBLIC_ADMIN_EMAIL,
    ).map((value) => value.toLowerCase());
}

export function getPrimaryAdminEmail() {
    return getAdminEmails()[0] || "";
}

export function getAdminPasswordAliases() {
    const adminPassword = String(process.env.ADMIN_PASSWORD || "").trim();
    return parseValues(process.env.ADMIN_PASSWORD_ALIASES || adminPassword);
}

function getAdminSessionSecret() {
    const secret =
        process.env.ADMIN_PORTAL_SECRET || process.env.ADMIN_SECRET || "";
    return secret.trim() || null;
}

function base64UrlEncode(input: string) {
    return Buffer.from(input, "utf8").toString("base64url");
}

function base64UrlDecode(input: string) {
    return Buffer.from(input, "base64url").toString("utf8");
}

function signAdminPayload(encodedPayload: string) {
    const secret = getAdminSessionSecret();
    if (!secret) {
        throw new Error("admin_portal_secret_not_configured");
    }
    return crypto
        .createHmac("sha256", secret)
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
    const adminEmail = getPrimaryAdminEmail();
    if (!adminEmail) {
        throw new Error("admin_email_not_configured");
    }
    const now = Date.now();
    const payload: AdminSessionPayload = {
        v: ADMIN_TOKEN_VERSION,
        type: "admin-portal",
        email: adminEmail,
        iat: now,
        exp: now + ADMIN_SESSION_TTL_MS,
    };
    const encodedPayload = base64UrlEncode(JSON.stringify(payload));
    const signature = signAdminPayload(encodedPayload);
    return `${encodedPayload}.${signature}`;
}

export function verifyAdminSessionToken(token: string): AdminUser | null {
    if (!getAdminSessionSecret()) return null;
    const parts = token.split(".");
    if (parts.length !== 2) return null;
    const [encodedPayload, signature] = parts;
    const expectedSignature = signAdminPayload(encodedPayload);
    if (!safeCompare(signature, expectedSignature)) return null;

    try {
        const payload = JSON.parse(
            base64UrlDecode(encodedPayload),
        ) as AdminSessionPayload;
        const adminEmails = getAdminEmails();
        if (payload.v !== ADMIN_TOKEN_VERSION) return null;
        if (payload.type !== "admin-portal") return null;
        if (!payload.email || !adminEmails.includes(payload.email)) return null;
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
        const adminEmails = getAdminEmails();

        if (!email || !adminEmails.includes(email)) {
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
    return !!email && getAdminEmails().includes(email.toLowerCase());
}

export { admin };
