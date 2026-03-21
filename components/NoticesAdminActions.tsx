"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { ADMIN_EMAILS, ADMIN_SESSION_STORAGE_KEY } from "@/lib/adminPortal";

export default function NoticesAdminActions() {
    const { user } = useAuth();
    const [hasAdminSession, setHasAdminSession] = useState(false);

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

    if (!isAdminUser) {
        return null;
    }

    return (
        <div className="notices-admin-actions">
            <Link href="/notices/write" className="notices-write-btn">
                글작성
            </Link>
        </div>
    );
}
