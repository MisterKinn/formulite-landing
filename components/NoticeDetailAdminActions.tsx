"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getAuth } from "firebase/auth";
import { useAuth } from "@/context/AuthContext";
import { getFirebaseAppOrNull } from "@/firebaseConfig";
import { ADMIN_EMAILS, ADMIN_SESSION_STORAGE_KEY } from "@/lib/adminPortal";
import { isDefaultNoticeSlug } from "@/lib/noticesShared";

export default function NoticeDetailAdminActions({ slug }: { slug: string }) {
    const router = useRouter();
    const { user } = useAuth();
    const [hasAdminSession, setHasAdminSession] = useState(false);
    const [deleting, setDeleting] = useState(false);

    useEffect(() => {
        const syncAdminSession = () => {
            const token = sessionStorage.getItem(ADMIN_SESSION_STORAGE_KEY);
            setHasAdminSession(Boolean(token));
        };

        syncAdminSession();
        window.addEventListener("storage", syncAdminSession);
        return () => window.removeEventListener("storage", syncAdminSession);
    }, []);

    const isAdminUser = useMemo(() => {
        const email = user?.email?.toLowerCase();
        return (email ? ADMIN_EMAILS.includes(email) : false) || hasAdminSession;
    }, [hasAdminSession, user?.email]);

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

    const handleDelete = async () => {
        if (isDefaultNoticeSlug(slug)) {
            alert("기본 공지는 삭제할 수 없습니다.");
            return;
        }

        if (!window.confirm("이 공지를 삭제하시겠습니까?")) {
            return;
        }

        setDeleting(true);
        try {
            const authorization = await getAuthorizationHeader();
            const response = await fetch(`/api/notices/${slug}`, {
                method: "DELETE",
                headers: {
                    Authorization: authorization,
                },
            });
            const data = await response.json().catch(() => null);

            if (!response.ok) {
                throw new Error(data?.error || "공지 삭제에 실패했습니다.");
            }

            router.push("/notices");
            router.refresh();
        } catch (error) {
            alert(
                error instanceof Error
                    ? error.message
                    : "공지 삭제에 실패했습니다.",
            );
        } finally {
            setDeleting(false);
        }
    };

    if (!isAdminUser) {
        return null;
    }

    return (
        <div className="notice-detail-admin-actions">
            <Link href={`/notices/${slug}/edit`} className="notice-admin-btn">
                수정
            </Link>
            <button
                type="button"
                className="notice-admin-btn notice-admin-btn--danger"
                onClick={handleDelete}
                disabled={deleting}
            >
                {deleting ? "삭제 중..." : "삭제"}
            </button>
        </div>
    );
}
