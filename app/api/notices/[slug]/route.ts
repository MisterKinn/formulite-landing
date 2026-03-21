export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { deleteNotice, updateNotice } from "@/lib/notices";
import { verifyAdmin } from "@/lib/adminAuth";

export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ slug: string }> },
) {
    const adminUser = await verifyAdmin(request.headers.get("Authorization"));
    if (!adminUser) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    try {
        const { slug } = await params;
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

        const notice = await updateNotice(slug, {
            category,
            title,
            summary,
            content,
            authorEmail: adminUser.email,
        });

        revalidatePath("/notices");
        revalidatePath(`/notices/${slug}`);
        revalidatePath(`/notices/${slug}/edit`);

        return NextResponse.json({ success: true, notice });
    } catch (error) {
        console.error("[api/notices/[slug]] failed to update notice", error);
        return NextResponse.json(
            { error: "공지 수정에 실패했습니다." },
            { status: 500 },
        );
    }
}

export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ slug: string }> },
) {
    const adminUser = await verifyAdmin(request.headers.get("Authorization"));
    if (!adminUser) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    try {
        const { slug } = await params;
        await deleteNotice(slug);

        revalidatePath("/notices");
        revalidatePath(`/notices/${slug}`);
        revalidatePath(`/notices/${slug}/edit`);

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("[api/notices/[slug]] failed to delete notice", error);
        const message =
            error instanceof Error &&
            error.message === "default_notice_cannot_be_deleted"
                ? "기본 공지는 삭제할 수 없습니다."
                : "공지 삭제에 실패했습니다.";
        return NextResponse.json({ error: message }, { status: 400 });
    }
}
