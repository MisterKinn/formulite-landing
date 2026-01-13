"use client";

import React, { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";

interface BillingKeyResult {
    success: boolean;
    billingKey?: string;
    error?: string;
    subscription?: any;
}

function CardRegistrationSuccessContent() {
    const searchParams = useSearchParams();
    const [result, setResult] = useState<BillingKeyResult | null>(null);
    const [loading, setLoading] = useState(true);

    const amount = Number(searchParams.get("amount")) || 0;
    const orderName = searchParams.get("orderName") || "";
    const billingCycle = searchParams.get("billingCycle") || "monthly";

    useEffect(() => {
        const processBillingAuth = async () => {
            try {
                const authKey = searchParams.get("authKey");
                const customerKey = searchParams.get("customerKey");

                if (!authKey || !customerKey) {
                    throw new Error("인증 정보가 누락되었습니다");
                }

                console.log("빌링키 발급 및 구독 생성 요청:", {
                    authKey,
                    customerKey,
                    amount,
                    orderName,
                    billingCycle,
                });

                // 서버에 빌링키 발급 요청
                const response = await fetch("/api/billing/issue", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        authKey,
                        customerKey,
                        amount,
                        orderName,
                        billingCycle,
                    }),
                });

                const data = await response.json();

                if (response.ok && data.success) {
                    setResult({
                        success: true,
                        billingKey: data.billingKey,
                        subscription: data.subscription,
                    });
                } else {
                    throw new Error(data.error || "빌링키 발급에 실패했습니다");
                }
            } catch (error: any) {
                console.error("빌링키 발급 오류:", error);
                setResult({
                    success: false,
                    error: error.message || "알 수 없는 오류가 발생했습니다",
                });
            } finally {
                setLoading(false);
            }
        };

        processBillingAuth();
    }, [searchParams]);

    if (loading) {
        return (
            <div style={styles.container}>
                <div style={styles.card}>
                    <div style={styles.spinner} />
                    <h1 style={styles.title}>카드 등록 처리 중...</h1>
                    <p style={styles.description}>잠시만 기다려주세요</p>
                </div>
            </div>
        );
    }

    if (!result || !result.success) {
        return (
            <div style={styles.container}>
                <div style={styles.card}>
                    <div style={styles.errorIcon}>❌</div>
                    <h1 style={styles.title}>카드 등록 실패</h1>
                    <p style={styles.description}>
                        {result?.error || "카드 등록에 실패했습니다"}
                    </p>
                    <div style={styles.buttonGroup}>
                        <button
                            style={styles.button}
                            onClick={() =>
                                (window.location.href = "/card-registration")
                            }
                        >
                            다시 시도
                        </button>
                        <button
                            style={styles.secondaryButton}
                            onClick={() => (window.location.href = "/profile")}
                        >
                            프로필로 이동
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div style={styles.container}>
            <div style={styles.card}>
                <div style={styles.successIcon}>✅</div>
                <h1 style={styles.title}>카드 등록 완료!</h1>
                <p style={styles.description}>
                    카드가 성공적으로 등록되었습니다.
                    <br />
                    이제 월간 구독 서비스를 이용하실 수 있습니다.
                </p>

                <div style={styles.infoBox}>
                    <h3 style={styles.infoTitle}>📋 구독 정보</h3>
                    <div style={styles.infoRow}>
                        <span>상품명:</span>
                        <span>{orderName || "Nova AI 구독"}</span>
                    </div>
                    <div style={styles.infoRow}>
                        <span>월간 요금:</span>
                        <span style={styles.price}>
                            {amount
                                ? `${amount.toLocaleString()}원`
                                : "설정 필요"}
                        </span>
                    </div>
                    <div style={styles.infoRow}>
                        <span>결제 주기:</span>
                        <span>
                            {billingCycle === "monthly" ? "매월" : "매년"}
                        </span>
                    </div>
                    <div style={styles.infoRow}>
                        <span>빌링키:</span>
                        <span style={styles.billingKey}>
                            {result.billingKey
                                ? `${result.billingKey.slice(0, 8)}****`
                                : "생성됨"}
                        </span>
                    </div>
                    <div style={styles.infoRow}>
                        <span>등록일시:</span>
                        <span>{new Date().toLocaleString("ko-KR")}</span>
                    </div>
                    <div style={styles.infoRow}>
                        <span>상태:</span>
                        <span style={styles.status}>활성</span>
                    </div>
                </div>

                <div style={styles.nextSteps}>
                    <h3 style={styles.nextTitle}>🚀 구독이 시작되었습니다!</h3>
                    <div style={styles.subscriptionInfo}>
                        <p>✅ 첫 번째 결제가 곧 처리됩니다</p>
                        <p>
                            ✅ 매월{" "}
                            {new Date(
                                Date.now() + 30 * 24 * 60 * 60 * 1000
                            ).getDate()}
                            일에 자동 결제
                        </p>
                        <p>✅ 언제든지 구독을 관리하거나 취소할 수 있습니다</p>
                    </div>
                </div>

                <div style={styles.buttonGroup}>
                    <button
                        style={styles.button}
                        onClick={() => (window.location.href = "/subscription")}
                    >
                        구독 관리
                    </button>
                    <button
                        style={styles.secondaryButton}
                        onClick={() => (window.location.href = "/")}
                    >
                        홈으로 이동
                    </button>
                </div>
            </div>
        </div>
    );
}

export default function CardRegistrationSuccessPage() {
    return (
        <Suspense
            fallback={
                <div style={styles.container}>
                    <div style={styles.card}>
                        <div style={styles.spinner} />
                        <h1 style={styles.title}>카드 등록 처리 중...</h1>
                        <p style={styles.description}>잠시만 기다려주세요</p>
                    </div>
                </div>
            }
        >
            <CardRegistrationSuccessContent />
        </Suspense>
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
        maxWidth: "600px",
        width: "100%",
        textAlign: "center",
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
    successIcon: {
        fontSize: "48px",
        marginBottom: "16px",
    } as React.CSSProperties,
    errorIcon: {
        fontSize: "48px",
        marginBottom: "16px",
    } as React.CSSProperties,
    title: {
        fontSize: "28px",
        fontWeight: "700",
        marginBottom: "16px",
        color: "#1f2937",
    } as React.CSSProperties,
    description: {
        fontSize: "16px",
        color: "#6b7280",
        marginBottom: "24px",
        lineHeight: "1.6",
    } as React.CSSProperties,
    infoBox: {
        backgroundColor: "#f0f9ff",
        border: "1px solid #bae6fd",
        borderRadius: "12px",
        padding: "20px",
        marginBottom: "24px",
        textAlign: "left",
    } as React.CSSProperties,
    infoTitle: {
        fontSize: "18px",
        fontWeight: "600",
        marginBottom: "12px",
        color: "#0369a1",
    } as React.CSSProperties,
    infoRow: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "8px 0",
        borderBottom: "1px solid #e0f2fe",
    } as React.CSSProperties,
    billingKey: {
        fontFamily: "monospace",
        backgroundColor: "#f1f5f9",
        padding: "4px 8px",
        borderRadius: "4px",
        fontSize: "14px",
    } as React.CSSProperties,
    price: {
        color: "#0164ff",
        fontWeight: "700",
        fontSize: "16px",
    } as React.CSSProperties,
    status: {
        color: "#10b981",
        fontWeight: "600",
    } as React.CSSProperties,
    nextSteps: {
        backgroundColor: "#fefce8",
        border: "1px solid #fde047",
        borderRadius: "12px",
        padding: "20px",
        marginBottom: "24px",
        textAlign: "left",
    } as React.CSSProperties,
    nextTitle: {
        fontSize: "18px",
        fontWeight: "600",
        marginBottom: "12px",
        color: "#a16207",
    } as React.CSSProperties,
    subscriptionInfo: {
        margin: "0",
        color: "#92400e",
        lineHeight: "1.6",
    } as React.CSSProperties,
    stepsList: {
        margin: "0",
        paddingLeft: "20px",
    } as React.CSSProperties,
    buttonGroup: {
        display: "flex",
        gap: "12px",
        justifyContent: "center",
        flexWrap: "wrap",
    } as React.CSSProperties,
    button: {
        padding: "16px 24px",
        fontSize: "16px",
        fontWeight: "600",
        border: "none",
        borderRadius: "12px",
        backgroundColor: "#0164ff",
        color: "#ffffff",
        cursor: "pointer",
        minWidth: "160px",
    } as React.CSSProperties,
    secondaryButton: {
        padding: "16px 24px",
        fontSize: "16px",
        fontWeight: "600",
        border: "2px solid #d1d5db",
        borderRadius: "12px",
        backgroundColor: "#ffffff",
        color: "#374151",
        cursor: "pointer",
        minWidth: "160px",
    } as React.CSSProperties,
};
