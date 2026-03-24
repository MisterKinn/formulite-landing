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
                if (!document.getElementById("toss-payments-sdk")) {
                    const script = document.createElement("script");
                    script.id = "toss-payments-sdk";
                    script.src = "https://js.tosspayments.com/v1/payment";
                    script.async = true;
                    await new Promise<void>((resolve, reject) => {
                        script.onload = () => resolve();
                        script.onerror = () => reject(new Error("SDK 로드 실패"));
                        document.head.appendChild(script);
                    });
                }
                const tp = (window as any).TossPayments(process.env.NEXT_PUBLIC_TOSS_BILLING_CLIENT_KEY!);
                setTossPayments(tp);
                setReady(true);
            } catch (err: any) {
                setError(err.message || "SDK 초기화 실패");
            }
        };
        if (user) loadTossSDK();
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
            await tossPayments.requestBillingAuth({
                method: "CARD",
                orderId,
                orderName,
                customerKey,
                customerEmail: user.email || "customer@example.com",
                customerName: user.displayName || "고객",
                successUrl: `${window.location.origin}/card-registration/success?amount=${amount}&orderName=${encodeURIComponent(orderName)}&billingCycle=${billingCycle}`,
                failUrl: `${window.location.origin}/card-registration/fail?amount=${amount}&orderName=${encodeURIComponent(orderName)}`,
            });
        } catch (err: any) {
            setError(err.message || "카드 등록에 실패했습니다");
        } finally {
            setLoading(false);
        }
    };

    if (!user) {
        return (
            <div style={s.fullscreen}>
                <div style={s.card}>
                    <h1 style={s.title}>로그인이 필요합니다</h1>
                    <p style={s.desc}>카드 등록을 위해 먼저 로그인해주세요.</p>
                    <button style={s.primaryBtn} onClick={() => (window.location.href = "/login")}>
                        로그인하기
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div style={s.fullscreen}>
            <div style={s.card}>
                <div style={s.iconWrap}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="2" y="5" width="20" height="14" rx="2" />
                        <line x1="2" y1="10" x2="22" y2="10" />
                    </svg>
                </div>

                <h1 style={s.title}>카드 등록</h1>
                <p style={s.desc}>
                    {billingCycle === "test"
                        ? "테스트 정기구독을 위한 카드 정보를 등록합니다."
                        : "월간 구독을 위한 카드 정보를 등록합니다."}
                </p>

                {error && <div style={s.errorBox}>{error}</div>}

                <div style={s.infoBox}>
                    <div style={s.infoRow}>
                        <span style={s.infoLabel}>상품명</span>
                        <span style={s.infoValue}>{orderName}</span>
                    </div>
                    <div style={s.infoRow}>
                        <span style={s.infoLabel}>결제 금액</span>
                        <span style={s.infoValueBlue}>{amount ? `${amount.toLocaleString()}원` : "설정 필요"}</span>
                    </div>
                    <div style={{ ...s.infoRow, borderBottom: "none", paddingBottom: 0 }}>
                        <span style={s.infoLabel}>결제 주기</span>
                        <span style={s.infoValue}>{billingCycleLabel}</span>
                    </div>
                </div>

                <button
                    style={{
                        ...s.primaryBtn,
                        opacity: ready && !loading ? 1 : 0.4,
                        cursor: ready && !loading ? "pointer" : "not-allowed",
                    }}
                    onClick={handleCardRegistration}
                    disabled={!ready || loading}
                >
                    {loading ? "처리 중..." : ready ? "카드 등록하기" : "로딩 중..."}
                </button>
            </div>
        </div>
    );
}

export default function CardRegistrationPage() {
    return (
        <Suspense
            fallback={
                <div style={s.fullscreen}>
                    <div style={s.card}>
                        <div style={s.spinner} />
                        <p style={{ color: "#888", fontSize: 13 }}>카드 등록 페이지를 준비하고 있습니다.</p>
                    </div>
                </div>
            }
        >
            <CardRegistrationContent />
        </Suspense>
    );
}

const s: Record<string, React.CSSProperties> = {
    fullscreen: {
        minHeight: "100vh",
        background: "#171717",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
    },
    card: {
        width: "100%",
        maxWidth: 420,
        background: "#222",
        borderRadius: 8,
        border: "1px solid #2e2e2e",
        padding: "32px 28px",
        textAlign: "center",
    },
    iconWrap: {
        width: 48,
        height: 48,
        borderRadius: "50%",
        background: "rgba(59,130,246,0.1)",
        border: "1px solid rgba(59,130,246,0.2)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        margin: "0 auto 20px",
    },
    spinner: {
        width: 36,
        height: 36,
        border: "3px solid #333",
        borderTop: "3px solid #ededed",
        borderRadius: "50%",
        animation: "spin 1s linear infinite",
        margin: "0 auto 16px",
    },
    title: {
        fontSize: 18,
        fontWeight: 500,
        marginBottom: 8,
        color: "#ededed",
    },
    desc: {
        fontSize: 13,
        color: "#888",
        marginBottom: 20,
        lineHeight: 1.5,
    },
    errorBox: {
        background: "rgba(224,73,86,0.08)",
        border: "1px solid rgba(224,73,86,0.2)",
        borderRadius: 6,
        padding: "10px 12px",
        marginBottom: 16,
        color: "#e04956",
        fontSize: 13,
        textAlign: "left",
    },
    infoBox: {
        background: "#1a1a1a",
        borderRadius: 6,
        border: "1px solid #2e2e2e",
        padding: 16,
        marginBottom: 20,
        textAlign: "left",
    },
    infoRow: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "8px 0",
        borderBottom: "1px solid #2e2e2e",
    },
    infoLabel: {
        fontSize: 13,
        color: "#666",
    },
    infoValue: {
        fontSize: 13,
        fontWeight: 500,
        color: "#ededed",
    },
    infoValueBlue: {
        fontSize: 13,
        fontWeight: 600,
        color: "#3b82f6",
    },
    primaryBtn: {
        width: "100%",
        height: 38,
        background: "#ededed",
        color: "#171717",
        border: "none",
        borderRadius: 6,
        fontSize: 13,
        fontWeight: 500,
        cursor: "pointer",
    },
};
