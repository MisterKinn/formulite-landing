export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { getRecentPurchaseFeedItems } from "@/lib/recentPurchaseFeed";
const NO_STORE_HEADERS = {
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    Pragma: "no-cache",
    Expires: "0",
    "CDN-Cache-Control": "no-store",
    "Vercel-CDN-Cache-Control": "no-store",
};

export async function GET() {
    try {
        const items = await getRecentPurchaseFeedItems();
        return NextResponse.json(
            { items },
            {
                headers: NO_STORE_HEADERS,
            },
        );
    } catch (error) {
        console.error("[recent-live] failed to load recent purchase feed", error);
        return NextResponse.json({ items: [] }, { headers: NO_STORE_HEADERS });
    }
}
