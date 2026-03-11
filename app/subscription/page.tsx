"use client";

import React, { useState, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { getFirestore, doc, getDoc } from "firebase/firestore";
import { getFirebaseAppOrNull } from "@/firebaseConfig";

interface SubscriptionInfo {
    billingKey?: string;
    customerKey?: string;
    plan: string;
    status: string;
    isRecurring: boolean;
    billingCycle?: "monthly" | "yearly" | "test";
    nextBillingDate?: string;
    registeredAt?: string;
    lastPaymentDate?: string;
    failureCount?: number;
}

export default function SubscriptionDashboard() {
    const { user } = useAuth();
    const [subscription, setSubscription] = useState<SubscriptionInfo | null>(
        null,
    );
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [actionLoading, setActionLoading] = useState<string | null>(null);

    useEffect(() => {
        if (user) {
            loadSubscriptionInfo();
        }
    }, [user]);

    const loadSubscriptionInfo = async () => {
        try {
            const firebaseApp = getFirebaseAppOrNull();
            if (!firebaseApp) {
                throw new Error("firebase_not_configured");
            }
            const db = getFirestore(firebaseApp);
            const userRef = doc(db, "users", user!.uid);
            const userDoc = await getDoc(userRef);

            if (userDoc.exists()) {
                const userData = userDoc.data();
                const sub = userData.subscription || null;
                setSubscription(sub);

                if (sub?.billingKey) {
                    console.log("🔑 사용자 빌링키 발견!");
                    console.log("   - 빌링키:", sub.billingKey);
                    console.log("   - 구독 상태:", sub.status);
                    console.log("   - 정기결제:", sub.isRecurring);
                    console.log("   - 결제 주기:", sub.billingCycle);
                } else {
                    console.log(
                        "⚠️ 빌링키가 없습니다. 카드를 먼저 등록해주세요.",
                    );
                }
            } else {
                setSubscription(null);
                console.log("⚠️ 사용자 구독 정보가 없습니다.");
            }
        } catch (err: any) {
            setError(err.message || "구독 정보를 불러올 수 없습니다");
        } finally {
            setLoading(false);
        }
    };

    const handleStartSubscription = async (
        plan: "go" | "plus" | "pro" | "test",
        cycle: "monthly" | "yearly" | "test",
    ) => {
        if (!subscription?.billingKey) {
            alert("먼저 카드를 등록해주세요");
            return;
        }

        setActionLoading(`subscribe_${plan}_${cycle}`);

        try {
            // 프로필 페이지의 구독 로직을 재사용 (단건 결제)
            const planPrices = {
                go: { monthly: 11900, yearly: 99960 },
                plus: { monthly: 120, yearly: 120 },
                test: { monthly: 100, yearly: 100, test: 100 },
                pro: { monthly: 99000, yearly: 831600 },
            };

            const amount =
                plan === "test"
                    ? planPrices.test.test
                    : planPrices[plan][cycle as "monthly" | "yearly"];
            const orderName = `Nova AI ${
                plan === "go"
                    ? "Go"
                    : plan === "plus"
                      ? "Plus"
                      : plan === "test"
                        ? "Test"
                        : "Ultra"
            } 요금제`;

            // 결제 페이지로 billingCycle을 함께 전달해야
            // 결제 성공 후 nextBillingDate가 월/연간에 맞게 계산됩니다.
            const params = new URLSearchParams({
                amount: String(amount),
                orderName,
                billingCycle: cycle,
            });
            window.location.href = `/payment?${params.toString()}`;
        } catch (err: any) {
            alert(err.message || "구독 시작에 실패했습니다");
        } finally {
            setActionLoading(null);
        }
    };

    const handleTestBilling = async () => {
        if (!subscription?.isRecurring) {
            alert("활성 구독이 없습니다");
            return;
        }

        setActionLoading("test_billing");

        try {
            const response = await fetch(`/api/billing/user/${user!.uid}`, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${
                        process.env.NEXT_PUBLIC_ADMIN_SECRET ||
                        "admin_secret_67890_secure"
                    }`,
                },
            });

            const result = await response.json();

            if (result.success) {
                alert(
                    `테스트 결제 성공!\n주문ID: ${result.result.orderId}\n금액: ${result.result.amount}원`,
                );
                loadSubscriptionInfo(); // 정보 새로고침
            } else {
                alert(`테스트 결제 실패: ${result.error}`);
            }
        } catch (err: any) {
            alert(err.message || "테스트 결제에 실패했습니다");
        } finally {
            setActionLoading(null);
        }
    };

    if (!user) {
        return (
            <div style={styles.container}>
                <div style={styles.card}>
                    <h1 style={styles.title}>로그인이 필요합니다</h1>
                    <button
                        style={styles.button}
                        onClick={() => (window.location.href = "/login")}
                    >
                        로그인하기
                    </button>
                </div>
            </div>
        );
    }

    if (loading) {
        return (
            <div style={styles.container}>
                <div style={styles.card}>
                    <div style={styles.spinner} />
                    <h1 style={styles.title}>구독 정보 로딩 중...</h1>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div style={styles.container}>
                <div style={styles.card}>
                    <h1 style={styles.title}>오류 발생</h1>
                    <p style={styles.description}>{error}</p>
                    <button
                        style={styles.button}
                        onClick={loadSubscriptionInfo}
                    >
                        다시 시도
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div style={styles.container}>
            <div style={styles.card}>
                <h1 style={styles.title}>🔔 구독 관리</h1>

                {/* 카드 등록 상태 */}
                <div style={styles.section}>
                    <h2 style={styles.sectionTitle}>💳 카드 등록 상태</h2>
                    {subscription?.billingKey ? (
                        <div style={styles.successBox}>
                            <p>
                                <strong>✅ 카드 등록 완료</strong>
                            </p>
                            <p>
                                빌링키: {subscription.billingKey.slice(0, 8)}
                                ****
                            </p>
                            <p>
                                등록일:{" "}
                                {subscription.registeredAt
                                    ? new Date(
                                          subscription.registeredAt,
                                      ).toLocaleString("ko-KR")
                                    : "정보 없음"}
                            </p>
                        </div>
                    ) : (
                        <div style={styles.warningBox}>
                            <p>
                                <strong>⚠️ 카드가 등록되지 않음</strong>
                            </p>
                            <button
                                style={styles.button}
                                onClick={() =>
                                    (window.location.href =
                                        "/card-registration")
                                }
                            >
                                카드 등록하기
                            </button>
                        </div>
                    )}
                </div>

                {/* 구독 상태 */}
                <div style={styles.section}>
                    <h2 style={styles.sectionTitle}>📋 구독 상태</h2>
                    {subscription?.isRecurring ? (
                        <div style={styles.activeSubscription}>
                            <p>
                                <strong>🎉 활성 구독</strong>
                            </p>
                            <div style={styles.subscriptionDetails}>
                                <div style={styles.detailRow}>
                                    <span>플랜:</span>
                                    <span style={styles.planBadge}>
                                        {subscription.plan.toUpperCase()}
                                    </span>
                                </div>
                                <div style={styles.detailRow}>
                                    <span>결제 주기:</span>
                                    <span>
                                        {subscription.billingCycle === "yearly"
                                            ? "연간"
                                            : subscription.billingCycle === "test"
                                              ? "테스트"
                                              : "월간"}
                                    </span>
                                </div>
                                <div style={styles.detailRow}>
                                    <span>다음 결제일:</span>
                                    <span>
                                        {subscription.nextBillingDate
                                            ? new Date(
                                                  subscription.nextBillingDate,
                                              ).toLocaleDateString("ko-KR")
                                            : "확인 중"}
                                    </span>
                                </div>
                                <div style={styles.detailRow}>
                                    <span>상태:</span>
                                    <span
                                        style={{
                                            color:
                                                subscription.status === "active"
                                                    ? "#10b981"
                                                    : "#dc2626",
                                        }}
                                    >
                                        {subscription.status === "active"
                                            ? "정상"
                                            : subscription.status}
                                    </span>
                                </div>
                                {subscription.lastPaymentDate && (
                                    <div style={styles.detailRow}>
                                        <span>마지막 결제:</span>
                                        <span>
                                            {new Date(
                                                subscription.lastPaymentDate,
                                            ).toLocaleDateString("ko-KR")}
                                        </span>
                                    </div>
                                )}
                                {subscription.failureCount &&
                                    subscription.failureCount > 0 && (
                                        <div style={styles.detailRow}>
                                            <span>실패 횟수:</span>
                                            <span style={{ color: "#dc2626" }}>
                                                {subscription.failureCount}회
                                            </span>
                                        </div>
                                    )}
                            </div>
                        </div>
                    ) : (
                        <div style={styles.inactiveSubscription}>
                            <p>
                                <strong>💤 비활성 구독</strong>
                            </p>
                            <p>현재 활성화된 구독이 없습니다.</p>
                        </div>
                    )}
                </div>

                {/* 구독 시작 */}
                {subscription?.billingKey && !subscription?.isRecurring && (
                    <div style={styles.section}>
                        <h2 style={styles.sectionTitle}>🚀 구독 시작</h2>
                        <div style={styles.planGrid}>
                            <div style={styles.planCard}>
                                <h3 style={styles.planTitle}>Go 요금제</h3>
                                <p style={styles.planPrice}>월 11,900원</p>
                                <button
                                    style={styles.button}
                                    onClick={() =>
                                        handleStartSubscription("go", "monthly")
                                    }
                                    disabled={actionLoading === "subscribe_go_monthly"}
                                >
                                    {actionLoading === "subscribe_go_monthly"
                                        ? "처리 중..."
                                        : "월간 구독"}
                                </button>
                                <button
                                    style={styles.secondaryButton}
                                    onClick={() =>
                                        handleStartSubscription("go", "yearly")
                                    }
                                    disabled={actionLoading === "subscribe_go_yearly"}
                                >
                                    {actionLoading === "subscribe_go_yearly"
                                        ? "처리 중..."
                                        : "연간 구독 (99,960원)"}
                                </button>
                            </div>

                            <div style={styles.planCard}>
                                <h3 style={styles.planTitle}>Plus 요금제</h3>
                                <p style={styles.planPrice}>월 120원</p>
                                <button
                                    style={styles.button}
                                    onClick={() =>
                                        handleStartSubscription(
                                            "plus",
                                            "monthly",
                                        )
                                    }
                                    disabled={
                                        actionLoading ===
                                        "subscribe_plus_monthly"
                                    }
                                >
                                    {actionLoading === "subscribe_plus_monthly"
                                        ? "처리 중..."
                                        : "월간 구독"}
                                </button>
                                <button
                                    style={styles.secondaryButton}
                                    onClick={() =>
                                        handleStartSubscription(
                                            "plus",
                                            "yearly",
                                        )
                                    }
                                    disabled={
                                        actionLoading ===
                                        "subscribe_plus_yearly"
                                    }
                                >
                                    {actionLoading === "subscribe_plus_yearly"
                                        ? "처리 중..."
                                        : "연간 구독 (120원)"}
                                </button>
                            </div>

                            <div style={styles.planCard}>
                                <h3 style={styles.planTitle}>Test 요금제</h3>
                                <p style={styles.planPrice}>테스트 100원</p>
                                <button
                                    style={styles.button}
                                    onClick={() =>
                                        handleStartSubscription("test", "test")
                                    }
                                    disabled={
                                        actionLoading === "subscribe_test_test"
                                    }
                                >
                                    {actionLoading === "subscribe_test_test"
                                        ? "처리 중..."
                                        : "테스트 구독"}
                                </button>
                            </div>

                            <div style={styles.planCard}>
                                <h3 style={styles.planTitle}>Ultra 요금제</h3>
                                <p style={styles.planPrice}>월 99,000원</p>
                                <button
                                    style={styles.button}
                                    onClick={() =>
                                        handleStartSubscription(
                                            "pro",
                                            "monthly",
                                        )
                                    }
                                    disabled={
                                        actionLoading ===
                                        "subscribe_pro_monthly"
                                    }
                                >
                                    {actionLoading === "subscribe_pro_monthly"
                                        ? "처리 중..."
                                        : "월간 구독"}
                                </button>
                                <button
                                    style={styles.secondaryButton}
                                    onClick={() =>
                                        handleStartSubscription("pro", "yearly")
                                    }
                                    disabled={
                                        actionLoading === "subscribe_pro_yearly"
                                    }
                                >
                                    {actionLoading === "subscribe_pro_yearly"
                                        ? "처리 중..."
                                        : "연간 구독 (831,600원)"}
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* 테스트 기능 */}
                {subscription?.isRecurring && (
                    <div style={styles.section}>
                        <h2 style={styles.sectionTitle}>🧪 테스트 기능</h2>
                        <button
                            style={styles.testButton}
                            onClick={handleTestBilling}
                            disabled={actionLoading === "test_billing"}
                        >
                            {actionLoading === "test_billing"
                                ? "결제 중..."
                                : "테스트 결제 실행"}
                        </button>
                        <p style={styles.testDescription}>
                            즉시 결제를 테스트하고 다음 결제일을 갱신합니다.
                        </p>
                    </div>
                )}

                {/* 네비게이션 */}
                <div style={styles.navigation}>
                    <button
                        style={styles.secondaryButton}
                        onClick={() => (window.location.href = "/")}
                    >
                        홈으로 이동
                    </button>
                    <button
                        style={styles.secondaryButton}
                        onClick={() => (window.location.href = "/profile")}
                    >
                        프로필
                    </button>
                </div>
            </div>
        </div>
    );
}

const styles = {
    container: {
        minHeight: "100vh",
        backgroundColor: "#f8fafc",
        padding: "20px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
    } as React.CSSProperties,
    card: {
        backgroundColor: "#ffffff",
        borderRadius: "16px",
        padding: "32px",
        boxShadow: "0 4px 20px rgba(0,0,0,0.1)",
        maxWidth: "800px",
        width: "100%",
    } as React.CSSProperties,
    title: {
        fontSize: "32px",
        fontWeight: "700",
        marginBottom: "24px",
        textAlign: "center",
        color: "#1f2937",
    } as React.CSSProperties,
    description: {
        fontSize: "16px",
        color: "#6b7280",
        marginBottom: "16px",
        textAlign: "center",
    } as React.CSSProperties,
    section: {
        marginBottom: "32px",
        paddingBottom: "24px",
        borderBottom: "1px solid #e5e7eb",
    } as React.CSSProperties,
    sectionTitle: {
        fontSize: "20px",
        fontWeight: "600",
        marginBottom: "16px",
        color: "#374151",
    } as React.CSSProperties,
    successBox: {
        backgroundColor: "#f0fdf4",
        border: "1px solid #10b981",
        borderRadius: "8px",
        padding: "16px",
    } as React.CSSProperties,
    warningBox: {
        backgroundColor: "#fefce8",
        border: "1px solid #fde047",
        borderRadius: "8px",
        padding: "16px",
    } as React.CSSProperties,
    activeSubscription: {
        backgroundColor: "#f0f9ff",
        border: "1px solid #0ea5e9",
        borderRadius: "8px",
        padding: "16px",
    } as React.CSSProperties,
    inactiveSubscription: {
        backgroundColor: "#f9fafb",
        border: "1px solid #d1d5db",
        borderRadius: "8px",
        padding: "16px",
    } as React.CSSProperties,
    subscriptionDetails: {
        marginTop: "12px",
    } as React.CSSProperties,
    detailRow: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "4px 0",
    } as React.CSSProperties,
    planBadge: {
        backgroundColor: "#0164ff",
        color: "#ffffff",
        padding: "2px 8px",
        borderRadius: "4px",
        fontSize: "12px",
        fontWeight: "600",
    } as React.CSSProperties,
    planGrid: {
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: "16px",
    } as React.CSSProperties,
    planCard: {
        border: "1px solid #d1d5db",
        borderRadius: "8px",
        padding: "16px",
        textAlign: "center",
    } as React.CSSProperties,
    planTitle: {
        fontSize: "18px",
        fontWeight: "600",
        marginBottom: "8px",
    } as React.CSSProperties,
    planPrice: {
        fontSize: "24px",
        fontWeight: "700",
        color: "#0164ff",
        marginBottom: "16px",
    } as React.CSSProperties,
    button: {
        width: "100%",
        padding: "12px",
        fontSize: "16px",
        fontWeight: "600",
        border: "none",
        borderRadius: "8px",
        backgroundColor: "#0164ff",
        color: "#ffffff",
        cursor: "pointer",
        marginBottom: "8px",
    } as React.CSSProperties,
    secondaryButton: {
        width: "100%",
        padding: "12px",
        fontSize: "16px",
        fontWeight: "600",
        border: "2px solid #d1d5db",
        borderRadius: "8px",
        backgroundColor: "#ffffff",
        color: "#374151",
        cursor: "pointer",
        marginBottom: "8px",
    } as React.CSSProperties,
    testButton: {
        padding: "12px 24px",
        fontSize: "16px",
        fontWeight: "600",
        border: "2px solid #f59e0b",
        borderRadius: "8px",
        backgroundColor: "#fbbf24",
        color: "#92400e",
        cursor: "pointer",
        marginBottom: "8px",
    } as React.CSSProperties,
    testDescription: {
        fontSize: "14px",
        color: "#6b7280",
        fontStyle: "italic",
    } as React.CSSProperties,
    navigation: {
        display: "flex",
        gap: "12px",
        justifyContent: "center",
        marginTop: "24px",
    } as React.CSSProperties,
    spinner: {
        width: "40px",
        height: "40px",
        border: "4px solid #f3f4f6",
        borderTop: "4px solid #0164ff",
        borderRadius: "50%",
        animation: "spin 1s linear infinite",
        margin: "0 auto 20px",
    } as React.CSSProperties,
};
