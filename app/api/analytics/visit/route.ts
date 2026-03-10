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

function getClientIp(request: NextRequest): string {
    const xForwardedFor = request.headers.get("x-forwarded-for");
    if (xForwardedFor) {
        const first = xForwardedFor.split(",")[0]?.trim();
        if (first) return first;
    }

    const xRealIp = request.headers.get("x-real-ip");
    if (xRealIp) return xRealIp.trim();

    const cfConnectingIp = request.headers.get("cf-connecting-ip");
    if (cfConnectingIp) return cfConnectingIp.trim();

    return "unknown";
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json().catch(() => ({}));
        const page = String(body?.page || "/").slice(0, 200);
        const ip = getClientIp(request).slice(0, 64);
        const dateKey = getDateKey();
        const docRef = db.collection("analyticsDaily").doc(dateKey);

        await db.runTransaction(async (tx) => {
            const snap = await tx.get(docRef);
            const prev = snap.exists ? snap.data() : {};
            const pageViews = (prev?.pageViews ?? {}) as Record<string, number>;
            const visitorsByIp = (prev?.visitorsByIp ?? {}) as Record<string, number>;
            const nextPageViews = {
                ...pageViews,
                [page]: (pageViews[page] || 0) + 1,
            };
            const nextVisitorsByIp = {
                ...visitorsByIp,
                [ip]: Date.now(),
            };
            const uniqueVisitors = Object.keys(nextVisitorsByIp).length;

            tx.set(
                docRef,
                {
                    date: dateKey,
                    visitors: uniqueVisitors,
                    visitorsByIp: nextVisitorsByIp,
                    pageViews: nextPageViews,
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
