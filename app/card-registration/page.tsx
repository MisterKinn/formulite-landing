"use client";

import React, { useState, useEffect, Suspense } from "react";
import { useAuth } from "../../context/AuthContext";
import { useSearchParams } from "next/navigation";

declare global {
    interface Window {
        TossPayments: any;
    }
}

function CardRegistrationContent() {
    const [ready, setReady] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [tossPayments, setTossPayments] = useState<any>(null);
    const { user } = useAuth();
    const searchParams = useSearchParams();

    // URL 파라미터에서 구독 정보 가져오기
    const amount = Number(searchParams.get("amount")) || 0;
    const orderName = searchParams.get("orderName") || "Nova AI 월간 구독";
    const billingCycle = searchParams.get("billingCycle") || "monthly";
    const billingCycleLabel =
        billingCycle === "test"
            ? "1분마다 100원 (테스트)"
            : billingCycle === "yearly"
              ? "매년"
              : "매월";

    useEffect(() => {
        const loadTossSDK = async () => {
            try {
                // 토스페이먼츠 SDK 로드
                if (!document.getElementById("toss-payments-sdk")) {
                    const script = document.createElement("script");
                    script.id = "toss-payments-sdk";
                    script.src = "https://js.tosspayments.com/v1/payment";
                    script.async = true;

                    await new Promise<void>((resolve, reject) => {
                        script.onload = () => resolve();
                        script.onerror = () =>
                            reject(new Error("SDK 로드 실패"));
                        document.head.appendChild(script);
                    });
                }

                // TossPayments 인스턴스 생성 (빌링용 클라이언트 키 사용)
                const tp = (window as any).TossPayments(
                    process.env.NEXT_PUBLIC_TOSS_BILLING_CLIENT_KEY!,
                );

                setTossPayments(tp);
                setReady(true);
            } catch (err: any) {
                setError(err.message || "SDK 초기화 실패");
            }
        };

        if (user) {
            loadTossSDK();
        }
    }, [user]);

    const handleCardRegistration = async () => {
        if (!tossPayments || !user) {
            setError("결제 시스템이 준비되지 않았습니다");
            return;
        }

        setLoading(true);
        setError(null);

        try {
            const customerKey = `user_${user.uid}_${Date.now()}`;
            const orderId = `billing_auth_${Date.now()}`;

            console.log("카드 등록 요청:", {
                customerKey,
                orderId,
                amount,
                orderName,
                billingCycle,
            });

            // 빌링 인증 요청
            await tossPayments.requestBillingAuth({
                method: "CARD",
                orderId,
                orderName: orderName,
                customerKey,
                customerEmail: user.email || "customer@example.com",
                customerName: user.displayName || "고객",
                successUrl: `${
                    window.location.origin
                }/card-registration/success?amount=${amount}&orderName=${encodeURIComponent(
                    orderName,
                )}&billingCycle=${billingCycle}`,
                failUrl: `${
                    window.location.origin
                }/card-registration/fail?amount=${amount}&orderName=${encodeURIComponent(
                    orderName,
                )}`,
            });
        } catch (err: any) {
            console.error("카드 등록 오류:", err);
            setError(err.message || "카드 등록에 실패했습니다");
        } finally {
            setLoading(false);
        }
    };

    if (!user) {
        return (
            <div style={styles.container}>
                <div style={styles.card}>
                    <h1 style={styles.title}>로그인이 필요합니다</h1>
                    <p style={styles.description}>
                        카드 등록을 위해 먼저 로그인해주세요.
                    </p>
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

    return (
        <div style={styles.container}>
            <div style={styles.card}>
                <h1 style={styles.title}>🏦 카드 등록</h1>
                <p style={styles.description}>
                    {billingCycle === "test"
                        ? "테스트 정기구독을 위한 카드 정보를 안전하게 등록합니다."
                        : "월간 구독을 위한 카드 정보를 안전하게 등록합니다."}
                    <br />
                    카드 정보는 토스페이먼츠에서 암호화되어 관리됩니다.
                </p>

                {error && (
                    <div style={styles.errorBox}>
                        <strong>❌ 오류:</strong> {error}
                    </div>
                )}

                <div style={styles.infoBox}>
                    <h3 style={styles.infoTitle}>📋 구독 정보</h3>
                    <p>
                        <strong>상품명:</strong> {orderName}
                    </p>
                    <p>
                        <strong>결제 금액:</strong>{" "}
                        {amount ? `${amount.toLocaleString()}원` : "설정 필요"}
                    </p>
                    <p>
                        <strong>결제 주기:</strong>{" "}
                        {billingCycleLabel}
                    </p>
                    <hr
                        style={{
                            margin: "12px 0",
                            border: "1px solid #e5e7eb",
                        }}
                    />
                    <p>
                        <strong>고객 ID:</strong> {user.uid}
                    </p>
                    <p>
                        <strong>이메일:</strong> {user.email}
                    </p>
                    <p>
                        <strong>이름:</strong> {user.displayName || "미설정"}
                    </p>
                </div>

                <button
                    style={{
                        ...styles.button,
                        backgroundColor: ready && !loading ? "#0164ff" : "#666",
                        cursor: ready && !loading ? "pointer" : "not-allowed",
                    }}
                    onClick={handleCardRegistration}
                    disabled={!ready || loading}
                >
                    {loading
                        ? "처리 중..."
                        : ready
                          ? "🔒 카드 등록하기"
                          : "로딩 중..."}
                </button>

                <div style={styles.testInfo}>
                    <h4 style={styles.testTitle}>🧪 테스트 카드 정보</h4>
                    <p>
                        <strong>카드번호:</strong> 4000-0000-0000-0002
                    </p>
                    <p>
                        <strong>만료일:</strong> 12/28
                    </p>
                    <p>
                        <strong>CVC:</strong> 123
                    </p>
                    <p>
                        <strong>비밀번호:</strong> 00
                    </p>
                </div>
            </div>
        </div>
    );
}

export default function CardRegistrationPage() {
    return (
        <Suspense
            fallback={
                <div style={styles.container}>
                    <div style={styles.card}>
                        <h1 style={styles.title}>⏳ 로딩 중...</h1>
                        <p style={styles.description}>
                            카드 등록 페이지를 준비하고 있습니다.
                        </p>
                    </div>
                </div>
            }
        >
            <CardRegistrationContent />
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
        maxWidth: "500px",
        width: "100%",
    } as React.CSSProperties,
    title: {
        fontSize: "28px",
        fontWeight: "700",
        marginBottom: "16px",
        textAlign: "center",
        color: "#1f2937",
    } as React.CSSProperties,
    description: {
        fontSize: "16px",
        color: "#6b7280",
        marginBottom: "24px",
        textAlign: "center",
        lineHeight: "1.6",
    } as React.CSSProperties,
    button: {
        width: "100%",
        padding: "16px",
        fontSize: "18px",
        fontWeight: "600",
        border: "none",
        borderRadius: "12px",
        backgroundColor: "#0164ff",
        color: "#ffffff",
        cursor: "pointer",
        marginBottom: "20px",
    } as React.CSSProperties,
    errorBox: {
        backgroundColor: "#fef2f2",
        border: "1px solid #fecaca",
        borderRadius: "8px",
        padding: "12px",
        marginBottom: "16px",
        color: "#dc2626",
    } as React.CSSProperties,
    infoBox: {
        backgroundColor: "#f0f9ff",
        border: "1px solid #bae6fd",
        borderRadius: "8px",
        padding: "16px",
        marginBottom: "20px",
    } as React.CSSProperties,
    infoTitle: {
        fontSize: "16px",
        fontWeight: "600",
        marginBottom: "8px",
        color: "#0369a1",
    } as React.CSSProperties,
    testInfo: {
        backgroundColor: "#fefce8",
        border: "1px solid #fde047",
        borderRadius: "8px",
        padding: "16px",
        fontSize: "14px",
    } as React.CSSProperties,
    testTitle: {
        fontSize: "14px",
        fontWeight: "600",
        marginBottom: "8px",
        color: "#a16207",
    } as React.CSSProperties,
};
