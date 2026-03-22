"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getAuth } from "firebase/auth";
import { useAuth } from "@/context/AuthContext";
import { getFirebaseAppOrNull } from "@/firebaseConfig";
import { ADMIN_EMAILS, ADMIN_SESSION_STORAGE_KEY } from "@/lib/adminPortal";
import type { NoticeItem } from "@/lib/notices";

export default function NoticeWriteForm({
    initialNotice,
    mode = "create",
}: {
    initialNotice?: NoticeItem;
    mode?: "create" | "edit";
}) {
    const router = useRouter();
    const { user, loading } = useAuth();
    const [hasAdminSession, setHasAdminSession] = useState(false);
    const [adminSessionChecked, setAdminSessionChecked] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [form, setForm] = useState({
        category: initialNotice?.category || "공지",
        title: initialNotice?.title || "",
        summary: initialNotice?.summary || "",
        content: initialNotice?.content || "",
    });

    useEffect(() => {
        const syncAdminSession = () => {
            const token = sessionStorage.getItem(ADMIN_SESSION_STORAGE_KEY);
            setHasAdminSession(Boolean(token));
            setAdminSessionChecked(true);
        };

        syncAdminSession();
        window.addEventListener("storage", syncAdminSession);
        return () => window.removeEventListener("storage", syncAdminSession);
    }, []);

    const isAdminUser = useMemo(() => {
        const email = user?.email?.toLowerCase();
        return (email ? ADMIN_EMAILS.includes(email) : false) || hasAdminSession;
    }, [hasAdminSession, user?.email]);

    useEffect(() => {
        if (!loading && adminSessionChecked && !isAdminUser) {
            router.replace("/login");
        }
    }, [adminSessionChecked, isAdminUser, loading, router]);

    const getAuthorizationHeader = async () => {
        if (user?.email && ADMIN_EMAILS.includes(user.email.toLowerCase())) {
            const firebaseApp = getFirebaseAppOrNull();
            if (!firebaseApp) {
                throw new Error("firebase_not_configured");
            }
            const auth = getAuth(firebaseApp);
            const currentUser = auth.currentUser;
            if (!currentUser) {
                throw new Error("admin_auth_required");
            }
            const token = await currentUser.getIdToken();
            return `Bearer ${token}`;
        }

        const adminSessionToken = sessionStorage.getItem(ADMIN_SESSION_STORAGE_KEY);
        if (!adminSessionToken) {
            throw new Error("admin_session_required");
        }
        return `Bearer ${adminSessionToken}`;
    };

    const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setError(null);
        setSubmitting(true);

        try {
            const authorization = await getAuthorizationHeader();
            const endpoint =
                mode === "edit" && initialNotice
                    ? `/api/notices/${initialNotice.slug}`
                    : "/api/notices";
            const response = await fetch(endpoint, {
                method: mode === "edit" ? "PATCH" : "POST",
                headers: {
                    Authorization: authorization,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(form),
            });
            const data = await response.json();

            if (!response.ok) {
                throw new Error(
                    data.error ||
                        (mode === "edit"
                            ? "공지 수정에 실패했습니다."
                            : "공지 저장에 실패했습니다."),
                );
            }

            router.push(`/notices/${data.notice.slug}`);
            router.refresh();
        } catch (submitError) {
            setError(
                submitError instanceof Error
                    ? submitError.message
                    : mode === "edit"
                      ? "공지 수정에 실패했습니다."
                      : "공지 저장에 실패했습니다.",
            );
        } finally {
            setSubmitting(false);
        }
    };

    if (loading || !adminSessionChecked || !isAdminUser) {
        return (
            <div className="notice-write-card">
                <p className="notice-write-helper">권한을 확인하고 있습니다.</p>
            </div>
        );
    }

    return (
        <form className="notice-write-card" onSubmit={handleSubmit}>
            <div className="notice-write-grid">
                <label className="notice-write-field">
                    <span>카테고리</span>
                    <input
                        type="text"
                        value={form.category}
                        onChange={(event) =>
                            setForm((prev) => ({
                                ...prev,
                                category: event.target.value,
                            }))
                        }
                        placeholder="공지"
                    />
                </label>
                <label className="notice-write-field">
                    <span>제목</span>
                    <input
                        type="text"
                        value={form.title}
                        onChange={(event) =>
                            setForm((prev) => ({
                                ...prev,
                                title: event.target.value,
                            }))
                        }
                        placeholder="공지 제목을 입력하세요"
                    />
                </label>
            </div>

            <label className="notice-write-field">
                <span>요약</span>
                <input
                    type="text"
                    value={form.summary}
                    onChange={(event) =>
                        setForm((prev) => ({
                            ...prev,
                            summary: event.target.value,
                        }))
                    }
                    placeholder="목록에 노출될 한 줄 요약"
                />
            </label>

            <label className="notice-write-field">
                <span>본문</span>
                <textarea
                    rows={16}
                    value={form.content}
                    onChange={(event) =>
                        setForm((prev) => ({
                            ...prev,
                            content: event.target.value,
                        }))
                    }
                    placeholder="블로그 글처럼 자유롭게 작성하세요. 줄바꿈은 그대로 반영됩니다."
                />
            </label>

            {error && <p className="notice-write-error">{error}</p>}

            <div className="notice-write-actions">
                <button
                    type="button"
                    className="notice-write-secondary-btn"
                    onClick={() => router.push("/notices")}
                    disabled={submitting}
                >
                    목록으로
                </button>
                <button
                    type="submit"
                    className="notice-write-primary-btn"
                    disabled={submitting}
                >
                    {submitting
                        ? mode === "edit"
                            ? "수정 중..."
                            : "게시 중..."
                        : mode === "edit"
                          ? "공지 수정"
                          : "공지 게시"}
                </button>
            </div>
        </form>
    );
}
