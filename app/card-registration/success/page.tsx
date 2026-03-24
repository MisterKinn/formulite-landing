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
    const userId = searchParams.get("uid");
    const billingCycleLabel =
        billingCycle === "test"
            ? "1분마다 100원 (테스트)"
            : billingCycle === "yearly"
              ? "매년"
              : "매월";

    useEffect(() => {
        const processBillingAuth = async () => {
            try {
                const authKey = searchParams.get("authKey");
                const customerKey = searchParams.get("customerKey");
                if (!authKey || !customerKey) throw new Error("인증 정보가 누락되었습니다");

                const response = await fetch("/api/billing/issue", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        authKey,
                        customerKey,
                        userId,
                        amount,
                        orderName,
                        billingCycle,
                    }),
                });
                const data = await response.json();

                if (response.ok && data.success) {
                    setResult({ success: true, billingKey: data.billingKey, subscription: data.subscription });
                } else {
                    throw new Error(data.error || "빌링키 발급에 실패했습니다");
                }
            } catch (error: any) {
                setResult({ success: false, error: error.message || "알 수 없는 오류가 발생했습니다" });
            } finally {
                setLoading(false);
            }
        };
        processBillingAuth();
    }, [amount, billingCycle, orderName, searchParams, userId]);

    if (loading) {
        return (
            <div style={s.fullscreen}>
                <div style={s.card}>
                    <div style={s.spinner} />
                    <h1 style={s.title}>카드 등록 처리 중...</h1>
                    <p style={s.desc}>잠시만 기다려주세요</p>
                </div>
            </div>
        );
    }

    if (!result || !result.success) {
        return (
            <div style={s.fullscreen}>
                <div style={s.card}>
                    <div style={s.failIcon}>
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                            <path d="M18 6L6 18M6 6l12 12" stroke="#e04956" strokeWidth="2.5" strokeLinecap="round" />
                        </svg>
                    </div>
                    <h1 style={s.title}>카드 등록 실패</h1>
                    <p style={s.desc}>{result?.error || "카드 등록에 실패했습니다"}</p>
                    <div style={s.btnGroup}>
                        <button style={s.primaryBtn} onClick={() => (window.location.href = "/card-registration")}>
                            다시 시도
                        </button>
                        <button style={s.secondaryBtn} onClick={() => (window.location.href = "/profile")}>
                            프로필로 이동
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div style={s.fullscreen}>
            <div style={s.card}>
                <div style={s.successIcon}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                        <path d="M20 6L9 17l-5-5" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                </div>

                <h1 style={s.title}>카드 등록 완료!</h1>
                <p style={s.desc}>
                    카드가 성공적으로 등록되었습니다.
                    <br />
                    {billingCycle === "test"
                        ? "이제 테스트 정기구독 자동결제를 확인할 수 있습니다."
                        : "이제 정기구독 서비스를 이용하실 수 있습니다."}
                </p>

                <div style={s.infoBox}>
                    <div style={s.sectionLabel}>구독 정보</div>
                    <div style={s.infoRow}>
                        <span style={s.infoLabel}>상품명</span>
                        <span style={s.infoValue}>{orderName || "Nova AI 구독"}</span>
                    </div>
                    <div style={s.infoRow}>
                        <span style={s.infoLabel}>결제 금액</span>
                        <span style={s.infoValueBlue}>{amount ? `${amount.toLocaleString()}원` : "설정 필요"}</span>
                    </div>
                    <div style={s.infoRow}>
                        <span style={s.infoLabel}>결제 주기</span>
                        <span style={s.infoValue}>{billingCycleLabel}</span>
                    </div>
                    <div style={s.infoRow}>
                        <span style={s.infoLabel}>상태</span>
                        <span style={s.statusBadge}>활성</span>
                    </div>
                </div>

                <div style={s.stepsBox}>
                    <div style={s.sectionLabel}>구독이 시작되었습니다</div>
                    <div style={s.stepItem}>
                        <span style={s.stepDot} />
                        <span style={s.stepText}>
                            {billingCycle === "test"
                                ? "다음 자동결제 예정 시각부터 1분 간격으로 청구됩니다"
                                : "첫 번째 결제가 곧 처리됩니다"}
                        </span>
                    </div>
                    <div style={s.stepItem}>
                        <span style={s.stepDot} />
                        <span style={s.stepText}>
                            {billingCycle === "test"
                                ? "관리자 페이지에서 상태를 확인할 수 있습니다"
                                : `매월 ${new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).getDate()}일에 자동 결제`}
                        </span>
                    </div>
                    <div style={s.stepItem}>
                        <span style={s.stepDot} />
                        <span style={s.stepText}>언제든지 구독을 관리하거나 취소할 수 있습니다</span>
                    </div>
                </div>

                <div style={s.btnGroup}>
                    <button style={s.primaryBtn} onClick={() => (window.location.href = "/")}>
                        홈으로 이동
                    </button>
                    <button style={s.secondaryBtn} onClick={() => (window.location.href = "/profile")}>
                        프로필로 이동
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
                <div style={s.fullscreen}>
                    <div style={s.card}>
                        <div style={s.spinner} />
                        <h1 style={s.title}>카드 등록 처리 중...</h1>
                        <p style={s.desc}>잠시만 기다려주세요</p>
                    </div>
                </div>
            }
        >
            <CardRegistrationSuccessContent />
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
        maxWidth: 460,
        background: "#222",
        borderRadius: 8,
        border: "1px solid #2e2e2e",
        padding: "32px 28px",
        textAlign: "center",
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
    successIcon: {
        width: 48,
        height: 48,
        borderRadius: "50%",
        background: "#3b82f6",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        margin: "0 auto 20px",
    },
    failIcon: {
        width: 48,
        height: 48,
        borderRadius: "50%",
        background: "rgba(224,73,86,0.1)",
        border: "1px solid rgba(224,73,86,0.2)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        margin: "0 auto 20px",
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
    infoBox: {
        background: "#1a1a1a",
        borderRadius: 6,
        border: "1px solid #2e2e2e",
        padding: 16,
        marginBottom: 16,
        textAlign: "left",
    },
    sectionLabel: {
        fontSize: 12,
        fontWeight: 500,
        color: "#666",
        textTransform: "uppercase" as const,
        letterSpacing: "0.04em",
        marginBottom: 12,
    },
    infoRow: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "7px 0",
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
    statusBadge: {
        fontSize: 12,
        fontWeight: 500,
        color: "#10b981",
        background: "rgba(16,185,129,0.1)",
        border: "1px solid rgba(16,185,129,0.2)",
        padding: "2px 8px",
        borderRadius: 4,
    },
    stepsBox: {
        background: "#1a1a1a",
        borderRadius: 6,
        border: "1px solid #2e2e2e",
        padding: 16,
        marginBottom: 20,
        textAlign: "left",
    },
    stepItem: {
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        marginBottom: 8,
    },
    stepDot: {
        width: 6,
        height: 6,
        borderRadius: "50%",
        background: "#3b82f6",
        flexShrink: 0,
        marginTop: 5,
    },
    stepText: {
        fontSize: 13,
        color: "#aaa",
        lineHeight: 1.5,
    },
    btnGroup: {
        display: "flex",
        gap: 8,
    },
    primaryBtn: {
        flex: 1,
        height: 38,
        background: "#ededed",
        color: "#171717",
        border: "none",
        borderRadius: 6,
        fontSize: 13,
        fontWeight: 500,
        cursor: "pointer",
    },
    secondaryBtn: {
        flex: 1,
        height: 38,
        background: "transparent",
        color: "#888",
        border: "1px solid #333",
        borderRadius: 6,
        fontSize: 13,
        fontWeight: 500,
        cursor: "pointer",
    },
};
