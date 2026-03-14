export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { verifyAdmin, admin } from "@/lib/adminAuth";

const db = admin.firestore();
const UPDATE_CONFIG_COLLECTION = "systemConfig";
const UPDATE_CONFIG_DOC_ID = "desktopUpdateManifest";

interface UpdateManifestPayload {
    latestVersion: string;
    minSupportedVersion: string;
    downloadUrl: string;
    releaseNotes: string;
    updatedAt?: string;
    updatedBy?: string;
}

function normalizeVersion(input: unknown): string {
    return String(input ?? "")
        .trim()
        .replace(/^v/i, "");
}

function normalizeUrl(input: unknown): string {
    return String(input ?? "").trim();
}

function toStoredPayload(input: Partial<UpdateManifestPayload>): UpdateManifestPayload {
    return {
        latestVersion: normalizeVersion(input.latestVersion),
        minSupportedVersion: normalizeVersion(input.minSupportedVersion),
        downloadUrl: normalizeUrl(input.downloadUrl),
        releaseNotes: String(input.releaseNotes ?? "").trim(),
    };
}

function validatePayload(payload: UpdateManifestPayload): string | null {
    if (!payload.latestVersion) {
        return "latestVersion is required";
    }
    if (!payload.minSupportedVersion) {
        return "minSupportedVersion is required";
    }
    if (!payload.downloadUrl) {
        return "downloadUrl is required";
    }
    try {
        new URL(payload.downloadUrl);
    } catch {
        return "downloadUrl must be a valid URL";
    }
    return null;
}

async function readUpdateManifest(): Promise<UpdateManifestPayload> {
    const docRef = db
        .collection(UPDATE_CONFIG_COLLECTION)
        .doc(UPDATE_CONFIG_DOC_ID);
    const snapshot = await docRef.get();
    if (!snapshot.exists) {
        return {
            latestVersion: "",
            minSupportedVersion: "",
            downloadUrl: "",
            releaseNotes: "",
        };
    }
    const data = snapshot.data() || {};
    return {
        latestVersion: normalizeVersion(data.latestVersion),
        minSupportedVersion: normalizeVersion(data.minSupportedVersion),
        downloadUrl: normalizeUrl(data.downloadUrl),
        releaseNotes: String(data.releaseNotes ?? "").trim(),
        updatedAt: String(data.updatedAt ?? ""),
        updatedBy: String(data.updatedBy ?? ""),
    };
}

export async function GET(request: NextRequest) {
    const adminUser = await verifyAdmin(request.headers.get("Authorization"));
    if (!adminUser) {
        return NextResponse.json(
            { error: "Unauthorized - Admin access required" },
            { status: 403 },
        );
    }

    try {
        const manifest = await readUpdateManifest();
        return NextResponse.json(manifest);
    } catch (error) {
        console.error("[admin/update-manifest] GET failed:", error);
        return NextResponse.json(
            { error: "Failed to load update manifest" },
            { status: 500 },
        );
    }
}

export async function PUT(request: NextRequest) {
    const adminUser = await verifyAdmin(request.headers.get("Authorization"));
    if (!adminUser) {
        return NextResponse.json(
            { error: "Unauthorized - Admin access required" },
            { status: 403 },
        );
    }

    try {
        const body = await request.json().catch(() => null);
        const payload = toStoredPayload(body || {});
        const errorMessage = validatePayload(payload);
        if (errorMessage) {
            return NextResponse.json({ error: errorMessage }, { status: 400 });
        }

        const nowIso = new Date().toISOString();
        const docRef = db
            .collection(UPDATE_CONFIG_COLLECTION)
            .doc(UPDATE_CONFIG_DOC_ID);
        await docRef.set(
            {
                ...payload,
                updatedAt: nowIso,
                updatedBy: adminUser.email || "unknown-admin",
            },
            { merge: true },
        );

        return NextResponse.json({
            success: true,
            manifest: {
                ...payload,
                updatedAt: nowIso,
                updatedBy: adminUser.email || "unknown-admin",
            },
        });
    } catch (error) {
        console.error("[admin/update-manifest] PUT failed:", error);
        return NextResponse.json(
            { error: "Failed to save update manifest" },
            { status: 500 },
        );
    }
}
