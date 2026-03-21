export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createNotice, listNotices } from "@/lib/notices";
import { verifyAdmin } from "@/lib/adminAuth";

export async function GET() {
    const notices = await listNotices();
    return NextResponse.json({ notices });
}

export async function POST(request: NextRequest) {
    const adminUser = await verifyAdmin(request.headers.get("Authorization"));
    if (!adminUser) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    try {
        const body = await request.json().catch(() => null);
        const title = String(body?.title || "").trim();
        const summary = String(body?.summary || "").trim();
        const content = String(body?.content || "").trim();
        const category = String(body?.category || "공지").trim();

        if (!title || !summary || !content) {
            return NextResponse.json(
                { error: "제목, 요약, 본문은 필수입니다." },
                { status: 400 },
            );
        }

        const notice = await createNotice({
            category,
            title,
            summary,
            content,
            authorEmail: adminUser.email,
        });

        revalidatePath("/notices");
        revalidatePath(`/notices/${notice.slug}`);

        return NextResponse.json({ success: true, notice });
    } catch (error) {
        console.error("[api/notices] failed to create notice", error);
        return NextResponse.json(
            { error: "공지 저장에 실패했습니다." },
            { status: 500 },
        );
    }
}
