export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import {
    createAdminSessionToken,
    getAdminPasswordAliases,
    getPrimaryAdminEmail,
} from "@/lib/adminAuth";

export async function POST(request: NextRequest) {
    try {
        const body = await request.json().catch(() => null);
        const email = String(body?.email ?? "").trim().toLowerCase();
        const password = String(body?.password ?? "").trim();
        const adminEmail = getPrimaryAdminEmail();
        const adminPasswordAliases = getAdminPasswordAliases();

        if (!adminEmail || adminPasswordAliases.length === 0) {
            return NextResponse.json(
                { error: "Admin portal credentials are not configured" },
                { status: 503 },
            );
        }

        if (
            email !== adminEmail ||
            !adminPasswordAliases.includes(password)
        ) {
            return NextResponse.json(
                { error: "Invalid admin credentials" },
                { status: 401 },
            );
        }

        const token = createAdminSessionToken();
        return NextResponse.json({
            success: true,
            token,
            admin: { email: adminEmail },
        });
    } catch {
        return NextResponse.json(
            { error: "Failed to sign in as admin" },
            { status: 500 },
        );
    }
}
