"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getAuth, onAuthStateChanged, User } from "firebase/auth";
import { app } from "@/firebaseConfig";
import "./admin.css";

interface Stats {
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
}

interface UserData {
    uid: string;
    email: string;
    displayName: string;
    createdAt: string;
    subscription: {
        plan: string;
        status: string;
        amount: number;
        billingCycle: string;
        nextBillingDate: string;
        failureCount: number;
        lastFailureReason?: string;
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

const ADMIN_EMAIL = "kinn@kinn.kr";

export default function AdminPage() {
    const router = useRouter();
    const [authUser, setAuthUser] = useState<User | null>(null);
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
            const token = await authUser?.getIdToken();
            const response = await fetch(`/api/admin/users/${userId}`, {
                method: "DELETE",
                headers: { Authorization: `Bearer ${token}` },
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

    useEffect(() => {
        const auth = getAuth(app);
        const unsubscribe = onAuthStateChanged(auth, (user) => {
            console.log(
                "Admin page auth check:",
                user?.email,
                "expected:",
                ADMIN_EMAIL,
            );

            if (user === null) {
                // User is not logged in
                setLoading(false);
                return;
            }

            // Case-insensitive email comparison
            if (user.email?.toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
                console.log("Not admin, redirecting...");
                router.push("/");
                return;
            }

            console.log("Admin verified!");
            setAuthUser(user);
            setLoading(false);
        });
        return () => unsubscribe();
    }, [router]);

    // Fetch stats
    useEffect(() => {
        if (!authUser) return;

        const fetchStats = async () => {
            setStatsLoading(true);
            try {
                const token = await authUser.getIdToken();
                const response = await fetch("/api/admin/stats", {
                    headers: { Authorization: `Bearer ${token}` },
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
    }, [authUser, activeTab]);

    // Fetch users
    useEffect(() => {
        if (!authUser || activeTab !== "users") return;

        const fetchUsers = async () => {
            setUsersLoading(true);
            try {
                const token = await authUser.getIdToken();
                const params = new URLSearchParams();
                if (userSearch) params.set("search", userSearch);
                if (userPlanFilter) params.set("plan", userPlanFilter);
                if (userStatusFilter) params.set("status", userStatusFilter);

                const response = await fetch(
                    `/api/admin/users?${params.toString()}`,
                    {
                        headers: { Authorization: `Bearer ${token}` },
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
    }, [authUser, activeTab, userSearch, userPlanFilter, userStatusFilter]);

    // Fetch payments
    useEffect(() => {
        if (!authUser || activeTab !== "payments") return;

        const fetchPayments = async () => {
            setPaymentsLoading(true);
            try {
                const token = await authUser.getIdToken();
                const params = new URLSearchParams();
                if (paymentSearch) params.set("search", paymentSearch);
                if (paymentStatusFilter)
                    params.set("status", paymentStatusFilter);
                if (paymentStartDate) params.set("startDate", paymentStartDate);
                if (paymentEndDate) params.set("endDate", paymentEndDate);

                const response = await fetch(
                    `/api/admin/payments?${params.toString()}`,
                    {
                        headers: { Authorization: `Bearer ${token}` },
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
        activeTab,
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

    if (!authUser) {
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

    return (
        <div className="admin-container">
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
                                <div className="admin-stats-grid">
                                    <div className="admin-stat-card">
                                        <h3>총 사용자</h3>
                                        <p className="admin-stat-value">
                                            {stats.totalUsers.toLocaleString()}
                                        </p>
                                    </div>
                                    <div className="admin-stat-card">
                                        <h3>활성 구독</h3>
                                        <p className="admin-stat-value">
                                            {stats.subscriptions.active.toLocaleString()}
                                        </p>
                                    </div>
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
                                <option value="basic">Basic</option>
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
                                            <th>이름</th>
                                            <th>플랜</th>
                                            <th>상태</th>
                                            <th>금액</th>
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
                                                    {user.displayName || "-"}
                                                </td>
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
                                                    {user.subscription.amount?.toLocaleString()}
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
