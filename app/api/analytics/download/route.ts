export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/adminAuth";

const db = admin.firestore();

function getDateKey(date = new Date()) {
    const formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Seoul",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    });
    return formatter.format(date);
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json().catch(() => ({}));
        const platform = String(body?.platform || "unknown").slice(0, 50);
        const dateKey = getDateKey();
        const docRef = db.collection("analyticsDaily").doc(dateKey);

        await db.runTransaction(async (tx) => {
            const snap = await tx.get(docRef);
            const prev = snap.exists ? snap.data() : {};
            const byPlatform = (prev?.downloadsByPlatform ??
                {}) as Record<string, number>;
            const nextByPlatform = {
                ...byPlatform,
                [platform]: (byPlatform[platform] || 0) + 1,
            };

            tx.set(
                docRef,
                {
                    date: dateKey,
                    downloads: (prev?.downloads || 0) + 1,
                    downloadsByPlatform: nextByPlatform,
                    updatedAt: Date.now(),
                },
                { merge: true },
            );
        });

        return NextResponse.json({ success: true });
    } catch {
        return NextResponse.json({ success: false, skipped: true });
    }
}
