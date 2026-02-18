"use client";
import React, { useState, useRef, useEffect } from "react";
import { useAuth } from "../context/AuthContext";
import { getFirestore, doc, getDoc } from "firebase/firestore";
import { getFirebaseAppOrNull } from "../firebaseConfig";
import { inferPlanFromAmount } from "@/lib/userData";

export function Navbar() {
    const { isAuthenticated, avatar, logout, user } = useAuth();
    const [displayName, setDisplayName] = useState<string | null>(null);
    const [userPlan, setUserPlan] = useState<string | null>(null);
    const [planResolved, setPlanResolved] = useState(false);
    const [aiUsage, setAiUsage] = useState<{
        currentUsage: number;
        limit: number;
        remaining: number;
    } | null>(null);

    const normalizePlan = (
        value?: unknown,
    ): "free" | "go" | "plus" | "pro" | "test" => {
        if (typeof value !== "string") return "free";
        const normalized = value.trim().toLowerCase();
        if (normalized === "pro" || normalized === "ultra") return "pro";
        if (normalized === "go") return "go";
        if (normalized === "plus" || normalized === "test") return normalized;
        return "free";
    };

    const inferPlanFromOrderName = (
        value?: unknown,
    ): "free" | "go" | "plus" | "pro" => {
        if (typeof value !== "string") return "free";
        const normalized = value.toLowerCase();
        if (normalized.includes("ultra") || normalized.includes("pro")) return "pro";
        if (normalized.includes("go")) return "go";
        if (normalized.includes("plus")) return "plus";
        return "free";
    };

    const getPlanRank = (plan: "free" | "go" | "plus" | "pro" | "test") => {
        if (plan === "pro") return 3;
        if (plan === "plus" || plan === "test") return 2;
        if (plan === "go") return 1;
        return 0;
    };

    const resolvePlanFromUserData = (
        data: any,
    ): "free" | "go" | "plus" | "pro" | "test" => {
        const direct = normalizePlan(
            data?.subscription?.plan ?? data?.plan ?? data?.tier,
        );
        if (direct !== "free") return direct;

        const fallbackByAmount =
            typeof data?.subscription?.amount === "number"
                ? (() => {
                      const inferred = inferPlanFromAmount(
                          data.subscription.amount,
                          data?.subscription?.billingCycle,
                      );
                      return inferred === "test" ? "plus" : inferred;
                  })()
                : "free";
        if (fallbackByAmount !== "free") return fallbackByAmount;

        return inferPlanFromOrderName(data?.subscription?.orderName);
    };

    useEffect(() => {
        let mounted = true;
        async function loadUserData() {
            if (!user) {
                if (mounted) {
                    setDisplayName(null);
                    setUserPlan(null);
                    setAiUsage(null);
                    setPlanResolved(false);
                }
                return;
            }
            if (mounted) setPlanResolved(false);
            if (user.displayName) {
                if (mounted) setDisplayName(user.displayName);
            }
            try {
                const firebaseApp = getFirebaseAppOrNull();
                if (!firebaseApp) return;
                const db = getFirestore(firebaseApp);
                const docRef = doc(db, "users", user.uid);
                const snap = await getDoc(docRef);
                if (mounted && snap.exists()) {
                    const data = snap.data() as any;
                    setDisplayName(data?.displayName ?? null);
                    setUserPlan(resolvePlanFromUserData(data));
                    setPlanResolved(true);
                }
            } catch (err) {
                // non-fatal
            }

            // Fetch AI usage data
            try {
                const res = await fetch(
                    `/api/ai/check-limit?userId=${user.uid}&t=${Date.now()}`,
                    { cache: "no-store" },
                );
                if (res.ok) {
                    const data = await res.json();
                    if (mounted) {
                        setAiUsage({
                            currentUsage: data.currentUsage,
                            limit: data.limit,
                            remaining: data.remaining,
                        });
                        const apiPlan = normalizePlan(data.plan);
                        setUserPlan((prev) => {
                            const prevPlan = normalizePlan(prev);
                            return getPlanRank(apiPlan) > getPlanRank(prevPlan)
                                ? apiPlan
                                : prevPlan;
                        });
                        setPlanResolved(true);
                    }
                }
            } catch (err) {
                // non-fatal
            }

            // Final fallback: infer from recent payment history when plan is still free
            try {
                const paymentsRes = await fetch(
                    `/api/payments/history?userId=${user.uid}`,
                );
                if (paymentsRes.ok && mounted) {
                    const payload = await paymentsRes.json();
                    const payments = Array.isArray(payload?.payments)
                        ? payload.payments
                        : [];
                    const latestPaid = payments.find((payment: any) => {
                        const status = String(payment?.status || "").toUpperCase();
                        return status === "DONE";
                    });
                    const inferredByHistory = normalizePlan(
                        inferPlanFromOrderName(latestPaid?.orderName),
                    );
                    if (getPlanRank(inferredByHistory) > getPlanRank("free")) {
                        setUserPlan((prev) => {
                            const prevPlan = normalizePlan(prev);
                            return getPlanRank(inferredByHistory) >
                                getPlanRank(prevPlan)
                                ? inferredByHistory
                                : prevPlan;
                        });
                    }
                    setPlanResolved(true);
                }
            } catch (err) {
                // non-fatal
            }
            if (mounted) {
                setPlanResolved(true);
                setUserPlan((prev) => prev ?? "free");
            }
        }
        loadUserData();
        return () => {
            mounted = false;
        };
    }, [user]);

    useEffect(() => {
        let mounted = true;
        async function refreshUsage() {
            if (!user) return;
            try {
                const res = await fetch(
                    `/api/ai/check-limit?userId=${user.uid}&t=${Date.now()}`,
                    { cache: "no-store" },
                );
                if (!res.ok) return;
                const data = await res.json();
                if (!mounted) return;
                setAiUsage({
                    currentUsage: data.currentUsage,
                    limit: data.limit,
                    remaining: data.remaining,
                });
                const apiPlan = normalizePlan(data.plan);
                setUserPlan((prev) => {
                    const prevPlan = normalizePlan(prev);
                    return getPlanRank(apiPlan) > getPlanRank(prevPlan)
                        ? apiPlan
                        : prevPlan;
                });
                setPlanResolved(true);
            } catch (err) {
                // non-fatal
            }
        }

        refreshUsage();
        const timer = window.setInterval(refreshUsage, 15000);
        return () => {
            mounted = false;
            window.clearInterval(timer);
        };
    }, [user]);
    const [menuOpen, setMenuOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

    // Get plan display name
    const getPlanDisplayName = (plan: string | null): string => {
        if (!plan || !planResolved) return "\uC694\uAE08\uC81C \uD655\uC778 \uC911";
        const planNames: Record<string, string> = {
            pro: "Ultra \uC694\uAE08\uC81C",
            plus: "Plus \uC694\uAE08\uC81C",
            go: "Go \uC694\uAE08\uC81C",
            test: "Plus \uC694\uAE08\uC81C",
            free: "Free",
        };
        return planNames[plan] || "Free";
    };

    // Close menu on outside click
    React.useEffect(() => {
        if (!menuOpen) return;
        function handleClick(e: MouseEvent) {
            if (
                menuRef.current &&
                !menuRef.current.contains(e.target as Node)
            ) {
                setMenuOpen(false);
            }
        }
        document.addEventListener("mousedown", handleClick);
        return () => document.removeEventListener("mousedown", handleClick);
    }, [menuOpen]);

    return (
        <nav className="navbar animate-fade-in">
            <div className="navbar-inner">
                <a href="/" title="NOVA AI" className="nav-brand no-hover">
                    <div className="brand-mark no-hover">
                        <img
                            src="/logogo.png"
                            alt="NOVA AI"
                            className="brand-mark-img"
                        />
                    </div>
                </a>

                <div className="nav-items">
                    <a href="/#exam-typing" className="nav-link">
                        {"\uC2DC\uD5D8\uC9C0 \uD0C0\uC774\uD551"}
                    </a>
                    <a href="/#pricing" className="nav-link">
                        {"\uC694\uAE08\uC81C"}
                    </a>
                    <a href="/download" className="nav-download-gradient">
                        {"\uC9C0\uAE08 \uB2E4\uC6B4\uB85C\uB4DC"}
                    </a>
                </div>

                <div className="nav-actions-group">
                    {isAuthenticated ? (
                        <div className="nav-profile-menu-wrapper" ref={menuRef}>
                            <button
                                className="nav-profile-trigger"
                                aria-label="\uD504\uB85C\uD544 \uBA54\uB274 \uC5F4\uAE30"
                                onClick={() => setMenuOpen((v) => !v)}
                            >
                                <img
                                    src={avatar || "/default-avatar.png"}
                                    alt="\uD504\uB85C\uD544"
                                    className="nav-profile-avatar-img"
                                />
                                <div className="nav-profile-info">
                                    <span className="nav-profile-email">
                                        {displayName ?? user?.email ?? "\uC0AC\uC6A9\uC790"}
                                    </span>
                                    <span className="nav-profile-plan">
                                        {getPlanDisplayName(userPlan)}
                                    </span>
                                </div>
                                <svg
                                    className={`nav-profile-chevron ${
                                        menuOpen ? "open" : ""
                                    }`}
                                    width="16"
                                    height="16"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                >
                                    <polyline points="6 9 12 15 18 9"></polyline>
                                </svg>
                            </button>
                            {menuOpen && (
                                <div className="nav-profile-dropdown">
                                    {/* Daily usage */}
                                    {aiUsage && (
                                        <div className="nav-usage-section">
                                            <div className="nav-usage-header">
                                                <svg
                                                    width="14"
                                                    height="14"
                                                    viewBox="0 0 24 24"
                                                    fill="none"
                                                    stroke="currentColor"
                                                    strokeWidth="2"
                                                    strokeLinecap="round"
                                                    strokeLinejoin="round"
                                                >
                                                    <path d="M12 20V10" />
                                                    <path d="M18 20V4" />
                                                    <path d="M6 20v-4" />
                                                </svg>
                                                <span>{"\uC624\uB298 \uC0AC\uC6A9\uB7C9"}</span>
                                            </div>
                                            <div className="nav-usage-bar-bg">
                                                <div
                                                    className="nav-usage-bar-fill"
                                                    style={{
                                                        width: `${Math.min(
                                                            (aiUsage.currentUsage /
                                                                aiUsage.limit) *
                                                                100,
                                                            100,
                                                        )}%`,
                                                        backgroundColor:
                                                            aiUsage.currentUsage >=
                                                            aiUsage.limit
                                                                ? "#ef4444"
                                                                : "#3b82f6",
                                                    }}
                                                />
                                            </div>
                                            <div className="nav-usage-info">
                                                <span className="nav-usage-remaining">
                                                    {"\uB0A8\uC740 \uD69F\uC218: "}
                                                    <strong>
                                                        {aiUsage.remaining}
                                                    </strong>
                                                </span>
                                                <span className="nav-usage-total">
                                                    {aiUsage.currentUsage} /{" "}
                                                    {aiUsage.limit}
                                                </span>
                                            </div>
                                        </div>
                                    )}
                                    {aiUsage && (
                                        <div className="nav-profile-dropdown-divider"></div>
                                    )}
                                    <a
                                        href="/profile"
                                        className="nav-profile-dropdown-item"
                                    >
                                        <svg
                                            width="16"
                                            height="16"
                                            viewBox="0 0 24 24"
                                            fill="none"
                                            stroke="currentColor"
                                            strokeWidth="1.5"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                        >
                                            <circle cx="12" cy="8" r="4" />
                                            <path d="M6 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2" />
                                        </svg>
                                        <span>{"\uD504\uB85C\uD544"}</span>
                                    </a>
                                    <a
                                        href="/profile"
                                        className="nav-profile-dropdown-item"
                                        onClick={() => {
                                            sessionStorage.setItem(
                                                "profileTab",
                                                "subscription",
                                            );
                                        }}
                                    >
                                        <svg
                                            width="16"
                                            height="16"
                                            viewBox="0 0 24 24"
                                            fill="none"
                                            stroke="currentColor"
                                            strokeWidth="1.5"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                        >
                                            <rect
                                                x="2"
                                                y="5"
                                                width="20"
                                                height="14"
                                                rx="2"
                                            />
                                            <line
                                                x1="2"
                                                y1="10"
                                                x2="22"
                                                y2="10"
                                            />
                                        </svg>
                                        <span>{"\uC694\uAE08\uC81C"}</span>
                                    </a>
                                    <a
                                        href="/profile"
                                        className="nav-profile-dropdown-item"
                                        onClick={() => {
                                            sessionStorage.setItem(
                                                "profileTab",
                                                "payment",
                                            );
                                        }}
                                    >
                                        <svg
                                            width="16"
                                            height="16"
                                            viewBox="0 0 24 24"
                                            fill="none"
                                            stroke="currentColor"
                                            strokeWidth="1.5"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                        >
                                            <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                                        </svg>
                                        <span>{"\uACB0\uC81C\uB0B4\uC5ED"}</span>
                                    </a>
                                    <div className="nav-profile-dropdown-divider"></div>
                                    <button
                                        className="nav-profile-dropdown-item nav-profile-logout-btn"
                                        onClick={async () => {
                                            setMenuOpen(false);
                                            await logout();
                                        }}
                                    >
                                        <svg
                                            width="16"
                                            height="16"
                                            viewBox="0 0 24 24"
                                            fill="none"
                                            stroke="currentColor"
                                            strokeWidth="1.5"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                        >
                                            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                                            <polyline points="16 17 21 12 16 7" />
                                            <line
                                                x1="21"
                                                y1="12"
                                                x2="9"
                                                y2="12"
                                            />
                                        </svg>
                                        <span>{"\uB85C\uADF8\uC544\uC6C3"}</span>
                                    </button>
                                </div>
                            )}
                        </div>
                    ) : (
                        <>
                            <a href="/login?mode=signup" className="nav-download-btn">
                                {"\uD68C\uC6D0\uAC00\uC785"}
                            </a>
                            <a href="/login" className="nav-login-btn">
                                {"\uB85C\uADF8\uC778"}
                            </a>
                        </>
                    )}
                </div>
            </div>
        </nav>
    );
}
