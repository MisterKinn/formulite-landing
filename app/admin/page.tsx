"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getAuth, onAuthStateChanged, signOut, User } from "firebase/auth";
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
        nextBillingDate: string;
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
    const [deletingUserId, setDeletingUserId] = useState<string | null>(null);
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

    // Handle user deletion
    const handleDeleteUser = async (userId: string, email: string) => {
        if (
            !confirm(
                `정말로 "${email}" 사용자를 삭제하시겠습니까?\n\n이 작업은 되돌릴 수 없으며, 모든 결제 내역도 함께 삭제됩니다.`,
            )
        ) {
            return;
        }

        setDeletingUserId(userId);
        try {
            const authorization = await getAdminAuthHeader();
            if (!authorization) throw new Error("관리자 인증이 필요합니다.");
            const response = await fetch(`/api/admin/users/${userId}`, {
                method: "DELETE",
                headers: { Authorization: authorization },
            });

            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.error || "삭제 실패");
            }

            // Remove user from local state
            setUsers(users.filter((u) => u.uid !== userId));
            setUsersTotal((prev) => prev - 1);
            alert("사용자가 삭제되었습니다.");
        } catch (error) {
            console.error("Delete user error:", error);
            alert(
                error instanceof Error
                    ? error.message
                    : "사용자 삭제에 실패했습니다.",
            );
        } finally {
            setDeletingUserId(null);
        }
    };

    // Handle remaining usage update
    const handleUpdateRemainingUsage = async (user: UserData) => {
        const rawValue =
            usageEditValues[user.uid] ?? String(user.usage?.remaining ?? 0);
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
            alert("남은 사용량이 수정되었습니다.");
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
    const handleUpdatePlan = async (user: UserData) => {
        const selectedPlan =
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
            alert("플랜이 수정되었고 사용량이 갱신되었습니다.");
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
    }, [authUser, adminSessionToken, activeTab, getAdminAuthHeader]);

    // Fetch users
    useEffect(() => {
        if ((!authUser && !adminSessionToken) || activeTab !== "users") return;

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
        activeTab,
        getAdminAuthHeader,
        userSearch,
        userPlanFilter,
        userStatusFilter,
    ]);

    // Fetch payments
    useEffect(() => {
        if ((!authUser && !adminSessionToken) || activeTab !== "payments")
            return;

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
        activeTab,
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
                    <h2 style={{ marginBottom: "1rem", color: "#111827" }}>
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

    return (
        <div className="admin-container">
            <header className="admin-header">
                <div className="admin-header-text">
                    <h1>관리자 페이지</h1>
                    <p>사용자, 결제, 통계를 한 곳에서 관리합니다.</p>
                </div>
                <div className="admin-header-actions">
                    <button
                        type="button"
                        className="admin-home-btn"
                        onClick={() => router.push("/")}
                    >
                        홈으로 이동
                    </button>
                    <button
                        type="button"
                        className="admin-logout-btn"
                        onClick={handleAdminLogout}
                    >
                        로그아웃
                    </button>
                </div>
            </header>
            <nav className="admin-nav">
                <button
                    className={`admin-nav-btn ${activeTab === "dashboard" ? "active" : ""}`}
                    onClick={() => setActiveTab("dashboard")}
                >
                    대시보드
                </button>
                <button
                    className={`admin-nav-btn ${activeTab === "users" ? "active" : ""}`}
                    onClick={() => setActiveTab("users")}
                >
                    사용자 관리
                </button>
                <button
                    className={`admin-nav-btn ${activeTab === "payments" ? "active" : ""}`}
                    onClick={() => setActiveTab("payments")}
                >
                    결제 내역
                </button>
            </nav>

            <main className="admin-main">
                {/* Dashboard Tab */}
                {activeTab === "dashboard" && (
                    <div className="admin-dashboard">
                        {statsLoading ? (
                            <div className="admin-loading-inline">
                                <div className="admin-spinner" />
                            </div>
                        ) : stats ? (
                            <>
                                {stats.warning && (
                                    <div className="admin-section">
                                        <p className="admin-refund-info">
                                            Firebase Admin 설정이 없어 실데이터를
                                            불러오지 못했습니다. 현재는 0값으로
                                            표시됩니다.
                                        </p>
                                    </div>
                                )}
                                <div className="admin-stats-grid">
                                    <div className="admin-stat-card">
                                        <h3>일 방문자 수</h3>
                                        <p className="admin-stat-value">
                                            {stats.dailyVisitors.toLocaleString()}
                                        </p>
                                    </div>
                                    <div className="admin-stat-card">
                                        <h3>일 다운로드 수</h3>
                                        <p className="admin-stat-value">
                                            {stats.dailyDownloads.toLocaleString()}
                                        </p>
                                    </div>
                                    <div className="admin-stat-card">
                                        <h3>회원가입 인원</h3>
                                        <p className="admin-stat-value">
                                            {stats.totalSignups.toLocaleString()}
                                        </p>
                                    </div>
                                    <div className="admin-stat-card">
                                        <h3>오늘 총 매출</h3>
                                        <p className="admin-stat-value">
                                            {stats.todaySales.toLocaleString()}
                                            원
                                        </p>
                                    </div>
                                </div>

                                <div className="admin-section">
                                    <h2>일자별 총 매출</h2>
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
                                                        <tr key={daily.date}>
                                                            <td>{daily.date}</td>
                                                            <td>
                                                                {
                                                                    daily.paymentCount
                                                                }
                                                                건
                                                            </td>
                                                            <td>
                                                                {daily.totalSales.toLocaleString()}
                                                                원
                                                            </td>
                                                        </tr>
                                                    ),
                                                )}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>

                                <div className="admin-stats-grid">
                                    <div className="admin-stat-card">
                                        <h3>월간 반복 수익 (MRR)</h3>
                                        <p className="admin-stat-value">
                                            {stats.revenue.totalMRR.toLocaleString()}
                                            원
                                        </p>
                                    </div>
                                    <div className="admin-stat-card">
                                        <h3>최근 30일 결제</h3>
                                        <p className="admin-stat-value">
                                            {stats.recentActivity.payments.total.toLocaleString()}
                                            원
                                        </p>
                                        <p className="admin-stat-sub">
                                            {
                                                stats.recentActivity.payments
                                                    .count
                                            }
                                            건
                                        </p>
                                    </div>
                                </div>

                                <div className="admin-section">
                                    <h2>플랜별 사용자</h2>
                                    <div className="admin-plan-grid">
                                        {Object.entries(stats.planCounts).map(
                                            ([plan, count]) => (
                                                <div
                                                    key={plan}
                                                    className="admin-plan-card"
                                                >
                                                    <span
                                                        className={`admin-plan-badge ${plan}`}
                                                    >
                                                        {plan.toUpperCase()}
                                                    </span>
                                                    <span className="admin-plan-count">
                                                        {count}명
                                                    </span>
                                                </div>
                                            ),
                                        )}
                                    </div>
                                </div>

                                <div className="admin-section">
                                    <h2>구독 상태</h2>
                                    <div className="admin-status-grid">
                                        <div className="admin-status-item">
                                            <span className="admin-status-label">
                                                활성
                                            </span>
                                            <span className="admin-status-value active">
                                                {stats.subscriptions.active}
                                            </span>
                                        </div>
                                        <div className="admin-status-item">
                                            <span className="admin-status-label">
                                                취소됨
                                            </span>
                                            <span className="admin-status-value cancelled">
                                                {stats.subscriptions.cancelled}
                                            </span>
                                        </div>
                                        <div className="admin-status-item">
                                            <span className="admin-status-label">
                                                일시정지
                                            </span>
                                            <span className="admin-status-value suspended">
                                                {stats.subscriptions.suspended}
                                            </span>
                                        </div>
                                        <div className="admin-status-item">
                                            <span className="admin-status-label">
                                                무료
                                            </span>
                                            <span className="admin-status-value free">
                                                {stats.subscriptions.free}
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                <div className="admin-section">
                                    <h2>최근 30일 환불</h2>
                                    <p className="admin-refund-info">
                                        {stats.recentActivity.refunds.count}건 /{" "}
                                        {stats.recentActivity.refunds.total.toLocaleString()}
                                        원
                                    </p>
                                </div>
                            </>
                        ) : (
                            <p>통계를 불러올 수 없습니다.</p>
                        )}
                    </div>
                )}

                {/* Users Tab */}
                {activeTab === "users" && (
                    <div className="admin-users">
                        <div className="admin-filters">
                            <input
                                type="text"
                                placeholder="이메일 검색..."
                                value={userSearch}
                                onChange={(e) => setUserSearch(e.target.value)}
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
                                <option value="pro">Pro</option>
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
                                <option value="cancelled">취소됨</option>
                                <option value="suspended">일시정지</option>
                            </select>
                        </div>

                        <p className="admin-result-count">총 {usersTotal}명</p>

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
                                            <th>현재 플랜</th>
                                            <th>상태</th>
                                            <th>오늘 사용량</th>
                                            <th>남은 사용량</th>
                                            <th>누적 금액</th>
                                            <th>다음 결제일</th>
                                            <th>실패 횟수</th>
                                            <th>작업</th>
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
                                                        {user.subscription.plan.toUpperCase()}
                                                    </span>
                                                </td>
                                                <td>
                                                    <span
                                                        className={`admin-status-badge ${user.subscription.status}`}
                                                    >
                                                        {
                                                            user.subscription
                                                                .status
                                                        }
                                                    </span>
                                                </td>
                                                <td>
                                                    {user.usage?.today ?? 0} /{" "}
                                                    {user.usage?.limit ?? 0}
                                                </td>
                                                <td>
                                                    {user.usage?.remaining ?? 0}
                                                </td>
                                                <td>
                                                    {(
                                                        user.cumulativeAmount || 0
                                                    ).toLocaleString()}
                                                    원
                                                </td>
                                                <td>
                                                    {user.subscription
                                                        .nextBillingDate
                                                        ? new Date(
                                                              user.subscription
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
                                                                        user.uid
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
                                                                onChange={(e) =>
                                                                    setPlanEditValues(
                                                                        (prev) => ({
                                                                            ...prev,
                                                                            [user.uid]:
                                                                                e
                                                                                    .target
                                                                                    .value as EditablePlan,
                                                                        }),
                                                                    )
                                                                }
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
                                                                    Pro
                                                                </option>
                                                            </select>
                                                            <button
                                                                onClick={() =>
                                                                    handleUpdatePlan(
                                                                        user,
                                                                    )
                                                                }
                                                                disabled={
                                                                    updatingPlanUserId ===
                                                                    user.uid
                                                                }
                                                                className="admin-save-btn"
                                                            >
                                                                {updatingPlanUserId ===
                                                                user.uid
                                                                    ? "저장 중..."
                                                                    : "플랜 저장"}
                                                            </button>
                                                        </div>
                                                        <div className="admin-usage-edit">
                                                            <input
                                                                type="number"
                                                                min={0}
                                                                max={
                                                                    user.usage
                                                                        ?.limit ?? 0
                                                                }
                                                                step={1}
                                                                value={
                                                                    usageEditValues[
                                                                        user.uid
                                                                    ] ??
                                                                    String(
                                                                        user.usage
                                                                            ?.remaining ??
                                                                            0,
                                                                    )
                                                                }
                                                                onChange={(e) =>
                                                                    setUsageEditValues(
                                                                        (prev) => ({
                                                                            ...prev,
                                                                            [user.uid]:
                                                                                e
                                                                                    .target
                                                                                    .value,
                                                                        }),
                                                                    )
                                                                }
                                                                className="admin-usage-input"
                                                            />
                                                            <button
                                                                onClick={() =>
                                                                    handleUpdateRemainingUsage(
                                                                        user,
                                                                    )
                                                                }
                                                                disabled={
                                                                    updatingUsageUserId ===
                                                                    user.uid
                                                                }
                                                                className="admin-save-btn"
                                                            >
                                                                {updatingUsageUserId ===
                                                                user.uid
                                                                    ? "저장 중..."
                                                                    : "저장"}
                                                            </button>
                                                        </div>
                                                        <button
                                                            onClick={() =>
                                                                handleDeleteUser(
                                                                    user.uid,
                                                                    user.email,
                                                                )
                                                            }
                                                            disabled={
                                                                deletingUserId ===
                                                                user.uid
                                                            }
                                                            className="admin-delete-btn"
                                                        >
                                                            {deletingUserId ===
                                                            user.uid
                                                                ? "삭제 중..."
                                                                : "삭제"}
                                                        </button>
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

                {/* Payments Tab */}
                {activeTab === "payments" && (
                    <div className="admin-payments">
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
                                <option value="REFUNDED">환불됨</option>
                            </select>
                            <input
                                type="date"
                                value={paymentStartDate}
                                onChange={(e) =>
                                    setPaymentStartDate(e.target.value)
                                }
                                className="admin-date"
                            />
                            <span style={{ color: "#a1a1aa" }}>~</span>
                            <input
                                type="date"
                                value={paymentEndDate}
                                onChange={(e) =>
                                    setPaymentEndDate(e.target.value)
                                }
                                className="admin-date"
                            />
                        </div>

                        <p className="admin-result-count">
                            총 {paymentsTotal}건
                        </p>

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
                                                    {new Date(
                                                        payment.approvedAt,
                                                    ).toLocaleDateString(
                                                        "ko-KR",
                                                        {
                                                            year: "numeric",
                                                            month: "short",
                                                            day: "numeric",
                                                            hour: "2-digit",
                                                            minute: "2-digit",
                                                        },
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
                                                    {payment.amount?.toLocaleString()}
                                                    원
                                                </td>
                                                <td>
                                                    {payment.card?.company ||
                                                        payment.method}
                                                    {payment.card?.number && (
                                                        <span className="admin-card-number">
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
                                                            : "환불됨"}
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
    );
}
