"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getAuth, onAuthStateChanged, signOut, User } from "firebase/auth";
import {
    CreditCard,
    Home,
    LayoutDashboard,
    LogOut,
    TrendingUp,
    Users,
} from "lucide-react";
import { getFirebaseAppOrNull } from "@/firebaseConfig";
import { ADMIN_EMAILS, ADMIN_SESSION_STORAGE_KEY } from "@/lib/adminPortal";
import "./admin.css";

interface Stats {
    dailyVisitors: number;
    dailyDownloads: number;
    todaySales: number;
    totalSignups: number;
    dailyRevenue: Array<{
        date: string;
        totalSales: number;
        paymentCount: number;
    }>;
    totalUsers: number;
    subscriptions: {
        active: number;
        cancelled: number;
        suspended: number;
        free: number;
    };
    planCounts: Record<string, number>;
    revenue: {
        monthlyRecurring: number;
        yearlyRecurring: number;
        totalMRR: number;
    };
    recentActivity: {
        payments: { count: number; total: number };
        refunds: { count: number; total: number };
    };
    warning?: string;
}

interface UserData {
    uid: string;
    email: string;
    displayName: string;
    createdAt: string;
    cumulativeAmount: number;
    subscription: {
        plan: string;
        status: string;
        amount: number;
        billingCycle: string;
        startDate?: string;
        nextBillingDate: string;
        periodLabel?: string;
        failureCount: number;
        lastFailureReason?: string;
    };
    usage: {
        today: number;
        limit: number;
        remaining: number;
    };
}

interface Payment {
    paymentKey: string;
    userId: string;
    userEmail: string;
    orderId: string;
    orderName: string;
    amount: number;
    method: string;
    status: string;
    approvedAt: string;
    card?: { company: string; number: string };
}

const EDITABLE_PLANS = ["free", "go", "plus", "pro"] as const;
type EditablePlan = (typeof EDITABLE_PLANS)[number];
const PLAN_LABELS: Record<string, string> = {
    free: "FREE",
    go: "GO",
    plus: "PLUS",
    pro: "ULTRA",
    ultra: "ULTRA",
};
export default function AdminPage() {
    const router = useRouter();
    const [authUser, setAuthUser] = useState<User | null>(null);
    const [adminSessionToken, setAdminSessionToken] = useState<string | null>(
        null,
    );
    const [portalAuthChecked, setPortalAuthChecked] = useState(false);
    const [firebaseAuthChecked, setFirebaseAuthChecked] = useState(false);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<
        "dashboard" | "users" | "payments"
    >("dashboard");

    // Dashboard state
    const [stats, setStats] = useState<Stats | null>(null);
    const [statsLoading, setStatsLoading] = useState(false);

    // Users state
    const [users, setUsers] = useState<UserData[]>([]);
    const [usersLoading, setUsersLoading] = useState(false);
    const [usersTotal, setUsersTotal] = useState(0);
    const [userSearch, setUserSearch] = useState("");
    const [userPlanFilter, setUserPlanFilter] = useState("");
    const [userStatusFilter, setUserStatusFilter] = useState("");

    // Payments state
    const [payments, setPayments] = useState<Payment[]>([]);
    const [paymentsLoading, setPaymentsLoading] = useState(false);
    const [paymentsTotal, setPaymentsTotal] = useState(0);
    const [paymentSearch, setPaymentSearch] = useState("");
    const [paymentStatusFilter, setPaymentStatusFilter] = useState("");
    const [paymentStartDate, setPaymentStartDate] = useState("");
    const [paymentEndDate, setPaymentEndDate] = useState("");

    // Delete state
    const [deletingPaymentKey, setDeletingPaymentKey] = useState<string | null>(
        null,
    );
    const [usageEditValues, setUsageEditValues] = useState<Record<string, string>>(
        {},
    );
    const [updatingUsageUserId, setUpdatingUsageUserId] = useState<string | null>(
        null,
    );
    const [planEditValues, setPlanEditValues] = useState<Record<string, EditablePlan>>(
        {},
    );
    const [updatingPlanUserId, setUpdatingPlanUserId] = useState<string | null>(
        null,
    );
    const usageSaveTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>(
        {},
    );

    const getAdminAuthHeader = useCallback(async () => {
        if (authUser) {
            const token = await authUser.getIdToken();
            return `Bearer ${token}`;
        }
        if (adminSessionToken) {
            return `Bearer ${adminSessionToken}`;
        }
        return null;
    }, [authUser, adminSessionToken]);

    // Handle payment deletion
    const handleDeletePayment = async (
        paymentKey: string,
        userId: string,
        orderName: string,
    ) => {
        if (
            !confirm(
                `정말로 이 결제 내역을 삭제하시겠습니까?\n\n주문명: ${orderName}\n결제키: ${paymentKey}`,
            )
        ) {
            return;
        }

        setDeletingPaymentKey(paymentKey);
        try {
            const authorization = await getAdminAuthHeader();
            if (!authorization) throw new Error("관리자 인증이 필요합니다.");
            const response = await fetch(
                `/api/admin/payments/${paymentKey}?userId=${userId}`,
                {
                    method: "DELETE",
                    headers: { Authorization: authorization },
                },
            );

            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.error || "삭제 실패");
            }

            // Remove payment from local state
            setPayments(payments.filter((p) => p.paymentKey !== paymentKey));
            setPaymentsTotal((prev) => prev - 1);
            alert("결제 내역이 삭제되었습니다.");
        } catch (error) {
            console.error("Delete payment error:", error);
            alert(
                error instanceof Error
                    ? error.message
                    : "결제 내역 삭제에 실패했습니다.",
            );
        } finally {
            setDeletingPaymentKey(null);
        }
    };

    // Handle remaining usage update
    const handleUpdateRemainingUsage = async (
        user: UserData,
        nextRemaining?: number,
    ) => {
        const rawValue =
            typeof nextRemaining === "number"
                ? String(nextRemaining)
                : (usageEditValues[user.uid] ?? String(user.usage?.remaining ?? 0));
        const parsedValue = Number(rawValue);
        const usageLimit = user.usage?.limit ?? 0;

        if (!Number.isInteger(parsedValue) || parsedValue < 0) {
            alert("남은 사용량은 0 이상의 정수여야 합니다.");
            return;
        }
        if (parsedValue > usageLimit) {
            alert(`남은 사용량은 현재 한도(${usageLimit})를 초과할 수 없습니다.`);
            return;
        }

        setUpdatingUsageUserId(user.uid);
        try {
            const authorization = await getAdminAuthHeader();
            if (!authorization) throw new Error("관리자 인증이 필요합니다.");

            const response = await fetch(`/api/admin/users/${user.uid}`, {
                method: "PATCH",
                headers: {
                    Authorization: authorization,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ remainingUsage: parsedValue }),
            });

            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.error || "남은 사용량 수정 실패");
            }

            setUsers((prev) =>
                prev.map((item) =>
                    item.uid === user.uid
                        ? {
                              ...item,
                              usage: {
                                  ...item.usage,
                                  ...data.usage,
                              },
                          }
                        : item,
                ),
            );
            setUsageEditValues((prev) => ({
                ...prev,
                [user.uid]: String(data.usage?.remaining ?? parsedValue),
            }));
        } catch (error) {
            console.error("Update remaining usage error:", error);
            alert(
                error instanceof Error
                    ? error.message
                    : "남은 사용량 수정에 실패했습니다.",
            );
        } finally {
            setUpdatingUsageUserId(null);
        }
    };

    // Handle plan update (usage limit/remaining changes together)
    const handleUpdatePlan = async (user: UserData, nextPlan?: EditablePlan) => {
        const selectedPlan =
            nextPlan ||
            planEditValues[user.uid] ||
            (EDITABLE_PLANS.includes(user.subscription.plan as EditablePlan)
                ? (user.subscription.plan as EditablePlan)
                : "free");

        setUpdatingPlanUserId(user.uid);
        try {
            const authorization = await getAdminAuthHeader();
            if (!authorization) throw new Error("관리자 인증이 필요합니다.");

            const response = await fetch(`/api/admin/users/${user.uid}`, {
                method: "PATCH",
                headers: {
                    Authorization: authorization,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ plan: selectedPlan }),
            });

            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.error || "플랜 수정 실패");
            }

            setUsers((prev) =>
                prev.map((item) =>
                    item.uid === user.uid
                        ? {
                              ...item,
                              subscription: {
                                  ...item.subscription,
                                  ...data.subscription,
                                  plan:
                                      data.subscription?.plan || selectedPlan,
                              },
                              usage: {
                                  ...item.usage,
                                  ...data.usage,
                              },
                          }
                        : item,
                ),
            );
            setPlanEditValues((prev) => ({
                ...prev,
                [user.uid]: (data.subscription?.plan ||
                    selectedPlan) as EditablePlan,
            }));
            setUsageEditValues((prev) => ({
                ...prev,
                [user.uid]: String(data.usage?.remaining ?? 0),
            }));
        } catch (error) {
            console.error("Update plan error:", error);
            alert(
                error instanceof Error
                    ? error.message
                    : "플랜 수정에 실패했습니다.",
            );
        } finally {
            setUpdatingPlanUserId(null);
        }
    };

    const scheduleRemainingUsageAutoSave = useCallback(
        (user: UserData, rawValue: string) => {
            setUsageEditValues((prev) => ({ ...prev, [user.uid]: rawValue }));
            if (rawValue === "") return;

            const parsedValue = Number(rawValue);
            if (!Number.isInteger(parsedValue)) return;

            const prevTimer = usageSaveTimersRef.current[user.uid];
            if (prevTimer) {
                clearTimeout(prevTimer);
            }
            usageSaveTimersRef.current[user.uid] = setTimeout(() => {
                void handleUpdateRemainingUsage(user, parsedValue);
                delete usageSaveTimersRef.current[user.uid];
            }, 500);
        },
        [handleUpdateRemainingUsage],
    );

    useEffect(() => {
        return () => {
            Object.values(usageSaveTimersRef.current).forEach((timerId) =>
                clearTimeout(timerId),
            );
            usageSaveTimersRef.current = {};
        };
    }, []);

    useEffect(() => {
        let active = true;

        const token =
            typeof window !== "undefined"
                ? sessionStorage.getItem(ADMIN_SESSION_STORAGE_KEY)
                : null;

        const verifyPortalSession = async () => {
            if (!token) {
                if (active) setPortalAuthChecked(true);
                return;
            }
            try {
                const response = await fetch("/api/admin/stats", {
                    headers: { Authorization: `Bearer ${token}` },
                });
                if (!active) return;
                if (response.ok) {
                    setAdminSessionToken(token);
                } else {
                    sessionStorage.removeItem(ADMIN_SESSION_STORAGE_KEY);
                    setAdminSessionToken(null);
                }
            } catch {
                if (active) setAdminSessionToken(null);
            } finally {
                if (active) setPortalAuthChecked(true);
            }
        };

        void verifyPortalSession();

        const firebaseApp = getFirebaseAppOrNull();
        if (!firebaseApp) {
            setAuthUser(null);
            setFirebaseAuthChecked(true);
            return () => {
                active = false;
            };
        }

        const auth = getAuth(firebaseApp);
        const unsubscribe = onAuthStateChanged(auth, (user) => {
            if (!active) return;
            const isFirebaseAdmin = !!user?.email && ADMIN_EMAILS.includes(user.email.toLowerCase());
            setAuthUser(isFirebaseAdmin ? user : null);
            setFirebaseAuthChecked(true);
        });

        return () => {
            active = false;
            unsubscribe();
        };
    }, [router]);

    useEffect(() => {
        setLoading(!(portalAuthChecked && firebaseAuthChecked));
    }, [portalAuthChecked, firebaseAuthChecked]);

    // Fetch stats
    useEffect(() => {
        if (!authUser && !adminSessionToken) return;

        const fetchStats = async () => {
            setStatsLoading(true);
            try {
                const authorization = await getAdminAuthHeader();
                if (!authorization) return;
                const response = await fetch("/api/admin/stats", {
                    headers: { Authorization: authorization },
                });
                if (response.ok) {
                    const data = await response.json();
                    setStats(data);
                }
            } catch (error) {
                console.error("Failed to fetch stats:", error);
            } finally {
                setStatsLoading(false);
            }
        };

        fetchStats();
    }, [authUser, adminSessionToken, getAdminAuthHeader]);

    // Fetch users
    useEffect(() => {
        if (!authUser && !adminSessionToken) return;

        const fetchUsers = async () => {
            setUsersLoading(true);
            try {
                const authorization = await getAdminAuthHeader();
                if (!authorization) return;
                const params = new URLSearchParams();
                if (userSearch) params.set("search", userSearch);
                if (userPlanFilter) params.set("plan", userPlanFilter);
                if (userStatusFilter) params.set("status", userStatusFilter);

                const response = await fetch(
                    `/api/admin/users?${params.toString()}`,
                    {
                        headers: { Authorization: authorization },
                    },
                );
                if (response.ok) {
                    const data = await response.json();
                    setUsers(data.users);
                    setUsersTotal(data.total);
                }
            } catch (error) {
                console.error("Failed to fetch users:", error);
            } finally {
                setUsersLoading(false);
            }
        };

        const debounce = setTimeout(fetchUsers, 300);
        return () => clearTimeout(debounce);
    }, [
        authUser,
        adminSessionToken,
        getAdminAuthHeader,
        userSearch,
        userPlanFilter,
        userStatusFilter,
    ]);

    // Fetch payments
    useEffect(() => {
        if (!authUser && !adminSessionToken) return;

        const fetchPayments = async () => {
            setPaymentsLoading(true);
            try {
                const authorization = await getAdminAuthHeader();
                if (!authorization) return;
                const params = new URLSearchParams();
                if (paymentSearch) params.set("search", paymentSearch);
                if (paymentStatusFilter)
                    params.set("status", paymentStatusFilter);
                if (paymentStartDate) params.set("startDate", paymentStartDate);
                if (paymentEndDate) params.set("endDate", paymentEndDate);

                const response = await fetch(
                    `/api/admin/payments?${params.toString()}`,
                    {
                        headers: { Authorization: authorization },
                    },
                );
                if (response.ok) {
                    const data = await response.json();
                    setPayments(data.payments);
                    setPaymentsTotal(data.total);
                }
            } catch (error) {
                console.error("Failed to fetch payments:", error);
            } finally {
                setPaymentsLoading(false);
            }
        };

        const debounce = setTimeout(fetchPayments, 300);
        return () => clearTimeout(debounce);
    }, [
        authUser,
        adminSessionToken,
        getAdminAuthHeader,
        paymentSearch,
        paymentStatusFilter,
        paymentStartDate,
        paymentEndDate,
    ]);

    if (loading) {
        return (
            <div className="admin-loading">
                <div className="admin-spinner" />
                <p>로딩 중...</p>
            </div>
        );
    }

    if (!authUser && !adminSessionToken) {
        return (
            <div className="admin-loading">
                <div style={{ textAlign: "center" }}>
                    <h2 style={{ marginBottom: "1rem", color: "#f8fafc" }}>
                        관리자 접근 권한이 필요합니다
                    </h2>
                    <p style={{ color: "#6b7280", marginBottom: "1.5rem" }}>
                        관리자 계정으로 로그인해주세요.
                    </p>
                    <button
                        onClick={() => router.push("/login")}
                        style={{
                            background: "#2563eb",
                            color: "white",
                            padding: "0.75rem 1.5rem",
                            borderRadius: "8px",
                            border: "none",
                            cursor: "pointer",
                        }}
                    >
                        로그인하기
                    </button>
                </div>
            </div>
        );
    }

    const handleAdminLogout = async () => {
        if (typeof window !== "undefined") {
            sessionStorage.removeItem(ADMIN_SESSION_STORAGE_KEY);
        }
        setAdminSessionToken(null);

        if (authUser) {
            const firebaseApp = getFirebaseAppOrNull();
            if (firebaseApp) {
                try {
                    await signOut(getAuth(firebaseApp));
                } catch {
                    // ignore sign out errors and continue redirect
                }
            }
        }

        router.push("/login");
    };

    const formatCurrency = (value: number) => `${value.toLocaleString()}원`;

    const formatDateTime = (value: string) =>
        new Date(value).toLocaleDateString("ko-KR", {
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        });

    const formatPeriodLabel = (subscription: UserData["subscription"]) => {
        if (subscription.plan === "free" || subscription.status === "none") {
            return "없음";
        }
        if (subscription.periodLabel) {
            return subscription.periodLabel;
        }
        if (subscription.startDate && subscription.nextBillingDate) {
            return `${new Date(subscription.startDate).toLocaleDateString("ko-KR")} ~ ${new Date(subscription.nextBillingDate).toLocaleDateString("ko-KR")}`;
        }
        return "-";
    };

    const navItems = [
        {
            key: "dashboard" as const,
            label: "대시보드",
            icon: <LayoutDashboard size={16} />,
        },
        {
            key: "users" as const,
            label: "사용자",
            icon: <Users size={16} />,
            count: usersTotal,
        },
        {
            key: "payments" as const,
            label: "결제",
            icon: <CreditCard size={16} />,
            count: paymentsTotal,
        },
    ];

    return (
        <div className="admin-container">
            <aside className="admin-sidebar">
                <div className="admin-brand">
                    <span className="admin-brand-dot" />
                    <div>
                        <h1>Nova Admin</h1>
                        <p>운영 콘솔</p>
                    </div>
                </div>

                <nav className="admin-sidebar-nav">
                    {navItems.map((item) => (
                        <button
                            key={item.key}
                            type="button"
                            className={`admin-sidebar-btn ${activeTab === item.key ? "active" : ""}`}
                            onClick={() => setActiveTab(item.key)}
                        >
                            <span className="admin-sidebar-btn-left">
                                {item.icon}
                                {item.label}
                            </span>
                            {typeof item.count === "number" && (
                                <span className="admin-sidebar-count">
                                    {item.count}
                                </span>
                            )}
                        </button>
                    ))}
                </nav>

                <div className="admin-sidebar-footer">
                    <p>로그인 계정</p>
                    <strong>{authUser?.email ?? "관리자 세션"}</strong>
                </div>
            </aside>

            <div className="admin-content">
                <header className="admin-header">
                    <div className="admin-header-text">
                        <h2>
                            {activeTab === "dashboard"
                                ? "서비스 운영 현황"
                                : activeTab === "users"
                                  ? "사용자 관리"
                                  : "결제 관리"}
                        </h2>
                        <p>
                            {activeTab === "dashboard"
                                ? "핵심 지표와 매출 흐름을 실시간으로 확인합니다."
                                : activeTab === "users"
                                  ? "회원 상태, 플랜, 사용량을 한 화면에서 관리합니다."
                                  : "결제 상태와 환불 이력을 빠르게 검토합니다."}
                        </p>
                    </div>
                    <div className="admin-header-actions">
                        <button
                            type="button"
                            className="admin-home-btn"
                            onClick={() => router.push("/")}
                        >
                            <Home size={14} />
                            홈
                        </button>
                        <button
                            type="button"
                            className="admin-logout-btn"
                            onClick={handleAdminLogout}
                        >
                            <LogOut size={14} />
                            로그아웃
                        </button>
                    </div>
                </header>

                <main className="admin-main">
                    {activeTab === "dashboard" && (
                        <div className="admin-dashboard">
                            {statsLoading ? (
                                <div className="admin-loading-inline">
                                    <div className="admin-spinner" />
                                </div>
                            ) : stats ? (
                                <>
                                    {stats.warning && (
                                        <div className="admin-banner-warning">
                                            Firebase Admin 설정이 없어 일부 지표가
                                            0으로 표시될 수 있습니다.
                                        </div>
                                    )}

                                    <section className="admin-kpi-grid">
                                        <article className="admin-kpi-card">
                                            <div className="admin-kpi-head">
                                                <span>일 방문자</span>
                                                <TrendingUp size={14} />
                                            </div>
                                            <strong>
                                                {stats.dailyVisitors.toLocaleString()}
                                            </strong>
                                        </article>
                                        <article className="admin-kpi-card">
                                            <div className="admin-kpi-head">
                                                <span>일 다운로드</span>
                                                <TrendingUp size={14} />
                                            </div>
                                            <strong>
                                                {stats.dailyDownloads.toLocaleString()}
                                            </strong>
                                        </article>
                                        <article className="admin-kpi-card">
                                            <div className="admin-kpi-head">
                                                <span>누적 회원</span>
                                                <Users size={14} />
                                            </div>
                                            <strong>
                                                {stats.totalSignups.toLocaleString()}
                                            </strong>
                                        </article>
                                        <article className="admin-kpi-card">
                                            <div className="admin-kpi-head">
                                                <span>오늘 매출</span>
                                                <CreditCard size={14} />
                                            </div>
                                            <strong>
                                                {formatCurrency(stats.todaySales)}
                                            </strong>
                                        </article>
                                    </section>

                                    <section className="admin-overview-grid">
                                        <article className="admin-panel">
                                            <h3>수익 요약</h3>
                                            <div className="admin-overview-list">
                                                <div>
                                                    <span>월간 반복 수익</span>
                                                    <strong>
                                                        {formatCurrency(
                                                            stats.revenue.totalMRR,
                                                        )}
                                                    </strong>
                                                </div>
                                                <div>
                                                    <span>최근 30일 결제</span>
                                                    <strong>
                                                        {formatCurrency(
                                                            stats.recentActivity
                                                                .payments.total,
                                                        )}
                                                    </strong>
                                                </div>
                                                <div>
                                                    <span>최근 30일 환불</span>
                                                    <strong className="negative">
                                                        {stats.recentActivity
                                                            .refunds.count}
                                                        건 /{" "}
                                                        {formatCurrency(
                                                            stats.recentActivity
                                                                .refunds.total,
                                                        )}
                                                    </strong>
                                                </div>
                                            </div>
                                        </article>
                                        <article className="admin-panel">
                                            <h3>구독 상태</h3>
                                            <div className="admin-status-grid">
                                                <div className="admin-status-item">
                                                    <span>활성</span>
                                                    <strong className="active">
                                                        {
                                                            stats.subscriptions
                                                                .active
                                                        }
                                                    </strong>
                                                </div>
                                                <div className="admin-status-item">
                                                    <span>취소</span>
                                                    <strong className="cancelled">
                                                        {
                                                            stats.subscriptions
                                                                .cancelled
                                                        }
                                                    </strong>
                                                </div>
                                                <div className="admin-status-item">
                                                    <span>일시정지</span>
                                                    <strong className="suspended">
                                                        {
                                                            stats.subscriptions
                                                                .suspended
                                                        }
                                                    </strong>
                                                </div>
                                                <div className="admin-status-item">
                                                    <span>무료</span>
                                                    <strong className="free">
                                                        {
                                                            stats.subscriptions
                                                                .free
                                                        }
                                                    </strong>
                                                </div>
                                            </div>
                                        </article>
                                    </section>

                                    <section className="admin-two-column">
                                        <article className="admin-panel">
                                            <h3>일자별 매출</h3>
                                            <div className="admin-table-wrapper">
                                                <table className="admin-table">
                                                    <thead>
                                                        <tr>
                                                            <th>일자</th>
                                                            <th>결제 건수</th>
                                                            <th>총 매출</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {stats.dailyRevenue.map(
                                                            (daily) => (
                                                                <tr
                                                                    key={
                                                                        daily.date
                                                                    }
                                                                >
                                                                    <td>
                                                                        {
                                                                            daily.date
                                                                        }
                                                                    </td>
                                                                    <td>
                                                                        {
                                                                            daily.paymentCount
                                                                        }
                                                                        건
                                                                    </td>
                                                                    <td>
                                                                        {formatCurrency(
                                                                            daily.totalSales,
                                                                        )}
                                                                    </td>
                                                                </tr>
                                                            ),
                                                        )}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </article>
                                        <article className="admin-panel">
                                            <h3>플랜 분포</h3>
                                            <div className="admin-plan-grid">
                                                {Object.entries(
                                                    stats.planCounts,
                                                ).map(([plan, count]) => (
                                                    <div
                                                        key={plan}
                                                        className="admin-plan-card"
                                                    >
                                                        <span
                                                            className={`admin-plan-badge ${plan}`}
                                                        >
                                                            {PLAN_LABELS[plan] ??
                                                                plan.toUpperCase()}
                                                        </span>
                                                        <strong>{count}명</strong>
                                                    </div>
                                                ))}
                                            </div>
                                        </article>
                                    </section>
                                </>
                            ) : (
                                <p>통계를 불러올 수 없습니다.</p>
                            )}
                        </div>
                    )}

                    {activeTab === "users" && (
                        <div className="admin-panel admin-users-panel">
                            <div className="admin-panel-head">
                                <h3>사용자 목록</h3>
                                <p>총 {usersTotal}명</p>
                            </div>
                            <div className="admin-filters">
                                <input
                                    type="text"
                                    placeholder="이메일 검색..."
                                    value={userSearch}
                                    onChange={(e) =>
                                        setUserSearch(e.target.value)
                                    }
                                    className="admin-search"
                                />
                                <select
                                    value={userPlanFilter}
                                    onChange={(e) =>
                                        setUserPlanFilter(e.target.value)
                                    }
                                    className="admin-select"
                                >
                                    <option value="">모든 플랜</option>
                                    <option value="free">Free</option>
                                    <option value="go">Go</option>
                                    <option value="plus">Plus</option>
                                    <option value="pro">Ultra</option>
                                </select>
                                <select
                                    value={userStatusFilter}
                                    onChange={(e) =>
                                        setUserStatusFilter(e.target.value)
                                    }
                                    className="admin-select"
                                >
                                    <option value="">모든 상태</option>
                                    <option value="active">활성</option>
                                    <option value="cancelled">취소</option>
                                    <option value="suspended">일시정지</option>
                                    <option value="none">없음</option>
                                </select>
                            </div>

                            {usersLoading ? (
                                <div className="admin-loading-inline">
                                    <div className="admin-spinner" />
                                </div>
                            ) : (
                                <div className="admin-table-wrapper">
                                    <table className="admin-table">
                                        <thead>
                                            <tr>
                                                <th>이메일</th>
                                                <th>플랜</th>
                                                <th>구독 기간</th>
                                                <th>오늘 사용량</th>
                                                <th>남은 사용량</th>
                                                <th>누적 금액</th>
                                                <th>다음 결제일</th>
                                                <th>실패 횟수</th>
                                                <th>관리</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {users.map((user) => (
                                                <tr key={user.uid}>
                                                    <td>{user.email}</td>
                                                    <td>
                                                        <span
                                                            className={`admin-plan-badge ${user.subscription.plan}`}
                                                        >
                                                            {PLAN_LABELS[
                                                                user.subscription
                                                                    .plan
                                                            ] ??
                                                                user.subscription.plan.toUpperCase()}
                                                        </span>
                                                    </td>
                                                    <td>
                                                        <span className="admin-subscription-period">
                                                            {formatPeriodLabel(
                                                                user.subscription,
                                                            )}
                                                        </span>
                                                    </td>
                                                    <td>
                                                        {user.usage?.today ?? 0} /{" "}
                                                        {user.usage?.limit ?? 0}
                                                    </td>
                                                    <td>
                                                        {user.usage?.remaining ??
                                                            0}
                                                    </td>
                                                    <td>
                                                        {formatCurrency(
                                                            user.cumulativeAmount ||
                                                                0,
                                                        )}
                                                    </td>
                                                    <td>
                                                        {user.subscription
                                                            .nextBillingDate
                                                            ? new Date(
                                                                  user
                                                                      .subscription
                                                                      .nextBillingDate,
                                                              ).toLocaleDateString(
                                                                  "ko-KR",
                                                              )
                                                            : "-"}
                                                    </td>
                                                    <td>
                                                        {user.subscription
                                                            .failureCount > 0 ? (
                                                            <span
                                                                className="admin-failure-count"
                                                                title={
                                                                    user
                                                                        .subscription
                                                                        .lastFailureReason
                                                                }
                                                            >
                                                                {
                                                                    user
                                                                        .subscription
                                                                        .failureCount
                                                                }
                                                            </span>
                                                        ) : (
                                                            "-"
                                                        )}
                                                    </td>
                                                    <td>
                                                        <div className="admin-action-group">
                                                            <div className="admin-plan-edit">
                                                                <select
                                                                    value={
                                                                        planEditValues[
                                                                            user
                                                                                .uid
                                                                        ] ||
                                                                        (EDITABLE_PLANS.includes(
                                                                            user
                                                                                .subscription
                                                                                .plan as EditablePlan,
                                                                        )
                                                                            ? (user
                                                                                  .subscription
                                                                                  .plan as EditablePlan)
                                                                            : "free")
                                                                    }
                                                                    onChange={(
                                                                        e,
                                                                    ) => {
                                                                        const selectedPlan =
                                                                            e
                                                                                .target
                                                                                .value as EditablePlan;
                                                                        setPlanEditValues(
                                                                            (
                                                                                prev,
                                                                            ) => ({
                                                                                ...prev,
                                                                                [user.uid]:
                                                                                    selectedPlan,
                                                                            }),
                                                                        );
                                                                        void handleUpdatePlan(
                                                                            user,
                                                                            selectedPlan,
                                                                        );
                                                                    }}
                                                                    className="admin-plan-select"
                                                                >
                                                                    <option value="free">
                                                                        Free
                                                                    </option>
                                                                    <option value="go">
                                                                        Go
                                                                    </option>
                                                                    <option value="plus">
                                                                        Plus
                                                                    </option>
                                                                    <option value="pro">
                                                                        Ultra
                                                                    </option>
                                                                </select>
                                                            </div>
                                                            <div className="admin-usage-edit">
                                                                <input
                                                                    type="number"
                                                                    min={0}
                                                                    max={
                                                                        user
                                                                            .usage
                                                                            ?.limit ??
                                                                        0
                                                                    }
                                                                    step={1}
                                                                    value={
                                                                        usageEditValues[
                                                                            user
                                                                                .uid
                                                                        ] ??
                                                                        String(
                                                                            user
                                                                                .usage
                                                                                ?.remaining ??
                                                                                0,
                                                                        )
                                                                    }
                                                                    onChange={(
                                                                        e,
                                                                    ) =>
                                                                        scheduleRemainingUsageAutoSave(
                                                                            user,
                                                                            e
                                                                                .target
                                                                                .value,
                                                                        )
                                                                    }
                                                                    className="admin-usage-input"
                                                                />
                                                            </div>
                                                            {(updatingPlanUserId ===
                                                                user.uid ||
                                                                updatingUsageUserId ===
                                                                    user.uid) && (
                                                                <span className="admin-inline-saving">
                                                                    저장 중...
                                                                </span>
                                                            )}
                                                        </div>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    )}

                    {activeTab === "payments" && (
                        <div className="admin-panel admin-payments-panel">
                            <div className="admin-panel-head">
                                <h3>결제 내역</h3>
                                <p>총 {paymentsTotal}건</p>
                            </div>
                            <div className="admin-filters">
                                <input
                                    type="text"
                                    placeholder="이메일 검색..."
                                    value={paymentSearch}
                                    onChange={(e) =>
                                        setPaymentSearch(e.target.value)
                                    }
                                    className="admin-search"
                                />
                                <select
                                    value={paymentStatusFilter}
                                    onChange={(e) =>
                                        setPaymentStatusFilter(e.target.value)
                                    }
                                    className="admin-select"
                                >
                                    <option value="">모든 상태</option>
                                    <option value="DONE">완료</option>
                                    <option value="REFUNDED">환불</option>
                                </select>
                                <input
                                    type="date"
                                    value={paymentStartDate}
                                    onChange={(e) =>
                                        setPaymentStartDate(e.target.value)
                                    }
                                    className="admin-date"
                                />
                                <input
                                    type="date"
                                    value={paymentEndDate}
                                    onChange={(e) =>
                                        setPaymentEndDate(e.target.value)
                                    }
                                    className="admin-date"
                                />
                            </div>

                            {paymentsLoading ? (
                                <div className="admin-loading-inline">
                                    <div className="admin-spinner" />
                                </div>
                            ) : (
                                <div className="admin-table-wrapper">
                                    <table className="admin-table">
                                        <thead>
                                            <tr>
                                                <th>결제일</th>
                                                <th>사용자</th>
                                                <th>주문명</th>
                                                <th>금액</th>
                                                <th>결제수단</th>
                                                <th>상태</th>
                                                <th>결제키</th>
                                                <th>삭제</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {payments.map((payment) => (
                                                <tr key={payment.paymentKey}>
                                                    <td>
                                                        {formatDateTime(
                                                            payment.approvedAt,
                                                        )}
                                                    </td>
                                                    <td>{payment.userEmail}</td>
                                                    <td>{payment.orderName}</td>
                                                    <td
                                                        className={
                                                            payment.status ===
                                                            "REFUNDED"
                                                                ? "refunded"
                                                                : ""
                                                        }
                                                    >
                                                        {formatCurrency(
                                                            payment.amount,
                                                        )}
                                                    </td>
                                                    <td>
                                                        {payment.card
                                                            ?.company ||
                                                            payment.method}
                                                        {payment.card
                                                            ?.number && (
                                                            <span className="admin-card-number">
                                                                *
                                                                {payment.card.number.slice(
                                                                    -4,
                                                                )}
                                                            </span>
                                                        )}
                                                    </td>
                                                    <td>
                                                        <span
                                                            className={`admin-payment-status ${payment.status}`}
                                                        >
                                                            {payment.status ===
                                                            "DONE"
                                                                ? "완료"
                                                                : "환불"}
                                                        </span>
                                                    </td>
                                                    <td className="admin-payment-key">
                                                        {payment.paymentKey.slice(
                                                            0,
                                                            20,
                                                        )}
                                                        ...
                                                    </td>
                                                    <td>
                                                        <button
                                                            onClick={() =>
                                                                handleDeletePayment(
                                                                    payment.paymentKey,
                                                                    payment.userId,
                                                                    payment.orderName,
                                                                )
                                                            }
                                                            disabled={
                                                                deletingPaymentKey ===
                                                                payment.paymentKey
                                                            }
                                                            className="admin-delete-btn"
                                                        >
                                                            {deletingPaymentKey ===
                                                            payment.paymentKey
                                                                ? "삭제 중..."
                                                                : "삭제"}
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    )}
                </main>
            </div>
        </div>
    );
}
