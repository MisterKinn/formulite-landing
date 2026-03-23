import getFirebaseAdmin from "@/lib/firebaseAdmin";
import { isDefaultNoticeSlug } from "@/lib/noticesShared";

export interface NoticeItem {
    slug: string;
    category: string;
    title: string;
    summary: string;
    content: string;
    publishedAt: string;
    updatedAt?: string;
    authorEmail?: string;
}

interface NoticeDoc {
    slug?: unknown;
    category?: unknown;
    title?: unknown;
    summary?: unknown;
    content?: unknown;
    publishedAt?: unknown;
    updatedAt?: unknown;
    authorEmail?: unknown;
}

const COLLECTION_NAME = "notices";

const DEFAULT_NOTICES: NoticeItem[] = [
    {
        slug: "1",
        category: "공지",
        title: "2026년 3월 9일 결제 및 업데이트 안내",
        summary:
            "토스페이먼츠 PG사 변경, UI/UX 업데이트, 채팅 편집모드 등 주요 변경사항을 안내드립니다.",
        content: [
            "토스페이먼츠 PG사 변경, UI/UX 업데이트, 채팅 편집모드 등 주요 변경사항을 안내드립니다.",
            "자세한 변경 내용은 메인 공지 이미지를 통해 순차적으로 확인하실 수 있습니다.",
        ].join("\n\n"),
        publishedAt: "2026-03-09T00:00:00.000Z",
    },
];

function normalizeNotice(slug: string, data: NoticeDoc): NoticeItem {
    return {
        slug: String(data.slug || slug),
        category: String(data.category || "공지"),
        title: String(data.title || ""),
        summary: String(data.summary || ""),
        content: String(data.content || ""),
        publishedAt: String(data.publishedAt || new Date().toISOString()),
        updatedAt: data.updatedAt ? String(data.updatedAt) : undefined,
        authorEmail: data.authorEmail ? String(data.authorEmail) : undefined,
    };
}

export function formatNoticeDate(value: string) {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        return value;
    }

    return parsed.toLocaleDateString("ko-KR", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    });
}

export function buildNoticeSlug(title: string) {
    const base = title
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9가-힣\s-]/g, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");
    const timestamp = Date.now().toString(36);
    return `${base || "notice"}-${timestamp}`;
}

export async function listNotices(): Promise<NoticeItem[]> {
    try {
        const admin = getFirebaseAdmin();
        const db = admin.firestore();
        const snapshot = await db
            .collection(COLLECTION_NAME)
            .orderBy("publishedAt", "desc")
            .get();

        if (snapshot.empty) {
            return DEFAULT_NOTICES;
        }

        return snapshot.docs.map((doc) =>
            normalizeNotice(doc.id, doc.data() as NoticeDoc),
        );
    } catch (error) {
        console.warn("[notices] falling back to default notices", error);
        return DEFAULT_NOTICES;
    }
}

export async function getNoticeBySlug(slug: string): Promise<NoticeItem | null> {
    try {
        const admin = getFirebaseAdmin();
        const db = admin.firestore();
        const docSnapshot = await db.collection(COLLECTION_NAME).doc(slug).get();

        if (docSnapshot.exists) {
            return normalizeNotice(slug, docSnapshot.data() as NoticeDoc);
        }
    } catch (error) {
        console.warn("[notices] failed to load notice", { slug, error });
    }

    return DEFAULT_NOTICES.find((notice) => notice.slug === slug) || null;
}

export async function createNotice(input: {
    category?: string;
    title: string;
    summary: string;
    content: string;
    authorEmail?: string;
}) {
    const admin = getFirebaseAdmin();
    const db = admin.firestore();
    const now = new Date().toISOString();
    const slug = buildNoticeSlug(input.title);

    const notice: NoticeItem = {
        slug,
        category: input.category?.trim() || "공지",
        title: input.title.trim(),
        summary: input.summary.trim(),
        content: input.content.trim(),
        publishedAt: now,
        updatedAt: now,
        authorEmail: input.authorEmail?.trim() || undefined,
    };

    await db.collection(COLLECTION_NAME).doc(slug).set(notice);
    return notice;
}

export async function updateNotice(
    slug: string,
    input: {
        category?: string;
        title: string;
        summary: string;
        content: string;
        authorEmail?: string;
    },
) {
    const admin = getFirebaseAdmin();
    const db = admin.firestore();
    const existing = await getNoticeBySlug(slug);

    if (!existing) {
        throw new Error("notice_not_found");
    }

    const updatedNotice: NoticeItem = {
        ...existing,
        category: input.category?.trim() || "공지",
        title: input.title.trim(),
        summary: input.summary.trim(),
        content: input.content.trim(),
        updatedAt: new Date().toISOString(),
        authorEmail: input.authorEmail?.trim() || existing.authorEmail,
    };

    await db.collection(COLLECTION_NAME).doc(slug).set(updatedNotice, { merge: true });
    return updatedNotice;
}

export async function deleteNotice(slug: string) {
    if (isDefaultNoticeSlug(slug)) {
        throw new Error("default_notice_cannot_be_deleted");
    }

    const admin = getFirebaseAdmin();
    const db = admin.firestore();
    await db.collection(COLLECTION_NAME).doc(slug).delete();
}
