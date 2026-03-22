import { NextRequest, NextResponse } from "next/server";
import getFirebaseAdmin from "@/lib/firebaseAdmin";

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;

function getBearerToken(authHeader: string | null): string | null {
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return null;
    }
    return authHeader.slice("Bearer ".length).trim() || null;
}

async function resolveAuthorizedUid(request: NextRequest): Promise<string | null> {
    const token = getBearerToken(request.headers.get("Authorization"));
    if (!token) return null;
    const admin = getFirebaseAdmin();
    const decoded = await admin.auth().verifyIdToken(token);
    return String(decoded.uid || "").trim() || null;
}

export async function GET(request: NextRequest) {
    try {
        const requestedUserId = String(
            request.nextUrl.searchParams.get("userId") || "",
        ).trim();
        const authorizedUid = await resolveAuthorizedUid(request);
        if (!authorizedUid || !requestedUserId || authorizedUid !== requestedUserId) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const limitParam = Number(request.nextUrl.searchParams.get("limit") || DEFAULT_LIMIT);
        const limit = Math.max(1, Math.min(MAX_LIMIT, Math.floor(limitParam || DEFAULT_LIMIT)));

        const admin = getFirebaseAdmin();
        const db = admin.firestore();
        const snapshot = await db
            .collection("users")
            .doc(requestedUserId)
            .collection("aiUsageLogs")
            .orderBy("createdAt", "desc")
            .limit(limit)
            .get();

        const logs = snapshot.docs.map((doc) => {
            const data = doc.data() as Record<string, unknown>;
            return {
                id: doc.id,
                model: String(data.model || ""),
                provider: String(data.provider || "gemini"),
                feature: String(data.feature || ""),
                source: String(data.source || "desktop"),
                promptTokens: Number(data.promptTokens || 0),
                outputTokens: Number(data.outputTokens || 0),
                totalTokens: Number(data.totalTokens || 0),
                createdAt: String(data.createdAt || ""),
            };
        });

        return NextResponse.json(
            { success: true, logs },
            {
                headers: {
                    "Cache-Control": "no-store, no-cache, must-revalidate",
                },
            },
        );
    } catch (error) {
        console.error("[ai/usage-history] GET failed:", error);
        return NextResponse.json(
            { success: false, error: "Failed to load usage history" },
            { status: 500 },
        );
    }
}

export async function POST(request: NextRequest) {
    try {
        const body = (await request.json()) as {
            userId?: unknown;
            model?: unknown;
            provider?: unknown;
            feature?: unknown;
            source?: unknown;
            promptTokens?: unknown;
            outputTokens?: unknown;
            totalTokens?: unknown;
            createdAt?: unknown;
        };

        const requestedUserId = String(body.userId || "").trim();
        const authorizedUid = await resolveAuthorizedUid(request);
        if (!authorizedUid || !requestedUserId || authorizedUid !== requestedUserId) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const promptTokens = Math.max(0, Math.floor(Number(body.promptTokens || 0)));
        const outputTokens = Math.max(0, Math.floor(Number(body.outputTokens || 0)));
        const totalTokens = Math.max(
            0,
            Math.floor(Number(body.totalTokens || promptTokens + outputTokens)),
        );

        const admin = getFirebaseAdmin();
        const db = admin.firestore();
        await db
            .collection("users")
            .doc(requestedUserId)
            .collection("aiUsageLogs")
            .add({
                model: String(body.model || ""),
                provider: String(body.provider || "gemini"),
                feature: String(body.feature || "typing"),
                source: String(body.source || "desktop"),
                promptTokens,
                outputTokens,
                totalTokens,
                createdAt:
                    typeof body.createdAt === "string" && body.createdAt
                        ? body.createdAt
                        : new Date().toISOString(),
            });

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("[ai/usage-history] POST failed:", error);
        return NextResponse.json(
            { success: false, error: "Failed to store usage history" },
            { status: 500 },
        );
    }
}
