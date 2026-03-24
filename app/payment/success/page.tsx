"use client";

import React, { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { Navbar } from "../../../components/Navbar";
import "../../style.css";
import "../../mobile.css";

function Loading() {
    return (
        <div style={s.fullscreen}>
            <div style={{ textAlign: "center" }}>
                <div style={s.spinner} />
                <h2 style={s.loadingTitle}>결제 처리 중</h2>
                <p style={s.loadingDesc}>잠시만 기다려주세요</p>
            </div>
        </div>
    );
}

function Fail({ error, onRetry }: { error: string; onRetry: () => void }) {
    return (
        <div style={s.fullscreen}>
            <div style={s.card}>
                <div style={s.failIcon}>
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                        <path d="M18 6L6 18M6 6l12 12" stroke="#e04956" strokeWidth="2.5" strokeLinecap="round" />
                    </svg>
                </div>
                <h1 style={s.title}>결제에 실패했습니다</h1>
                <p style={s.desc}>{error}</p>
                <button style={s.primaryBtn} onClick={onRetry}>다시 결제하기</button>
            </div>
        </div>
    );
}

function Success({ result }: { result: any }) {
    const orderId = result?.data?.orderId ?? "-";
    const method = result?.data?.method ?? "-";
    const amount = Number(result?.data?.totalAmount ?? result?.data?.amount ?? 0);
    const productType = result?.productType || "subscription";
    const tokensGranted = Number(result?.tokensGranted || 0);

    return (
        <div style={s.fullscreen}>
            <div style={s.card}>
                <div style={s.successIcon}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                        <path d="M20 6L9 17l-5-5" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                </div>

                <h1 style={s.title}>
                    {productType === "token_pack" ? "토큰 충전이 완료되었습니다" : "결제가 완료되었습니다"}
                </h1>
                <p style={s.desc}>
                    {productType === "token_pack"
                        ? "추가 토큰이 계정에 반영되었습니다."
                        : "결제가 정상적으로 처리되었습니다."}
                </p>

                <div style={s.divider} />

                <div style={s.infoRow}>
                    <span style={s.label}>주문번호</span>
                    <span style={s.value}>{orderId}</span>
                </div>
                <div style={s.infoRow}>
                    <span style={s.label}>결제금액</span>
                    <span style={s.valueHighlight}>{amount.toLocaleString()}원</span>
                </div>
                <div style={s.infoRow}>
                    <span style={s.label}>결제수단</span>
                    <span style={s.value}>{method}</span>
                </div>

                {productType === "token_pack" && tokensGranted > 0 && (
                    <div style={s.infoRow}>
                        <span style={s.label}>충전 토큰</span>
                        <span style={s.value}>{tokensGranted.toLocaleString()} 토큰</span>
                    </div>
                )}

                <button style={{ ...s.primaryBtn, marginTop: 24 }} onClick={() => (window.location.href = "/")}>
                    홈으로 이동
                </button>
            </div>
        </div>
    );
}

export default function PaymentSuccessPage() {
    return (
        <>
            <Navbar />
            <React.Suspense fallback={<Loading />}>
                <PaymentSuccessContent />
            </React.Suspense>
        </>
    );
}

function PaymentSuccessContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const confirmedRef = useRef(false);
    const [loading, setLoading] = useState(true);
    const [result, setResult] = useState<any>(null);
    const [error, setError] = useState("");
    const { loading: authLoading, user } = useAuth();

    useEffect(() => {
        if (authLoading || confirmedRef.current) return;
        confirmedRef.current = true;

        const confirm = async () => {
            try {
                const paymentKey = searchParams.get("paymentKey");
                const orderId = searchParams.get("orderId");
                const amount = searchParams.get("amount");
                const authKey = searchParams.get("authKey");
                const customerKey = searchParams.get("customerKey");
                const isRecurring = searchParams.get("recurring") === "true";
                const orderName = searchParams.get("orderName") || "";
                const billingCycle = searchParams.get("billingCycle") || "monthly";
                const urlUserId = searchParams.get("uid");
                const resolvedUserId = urlUserId || user?.uid || null;

                if (isRecurring && paymentKey && !authKey) {
                    const urlCustomerKey = searchParams.get("customerKey");
                    const finalCustomerKey =
                        urlCustomerKey ||
                        (resolvedUserId
                            ? `user_${resolvedUserId.replace(/[^a-zA-Z0-9\-_=.@]/g, "").substring(0, 40)}`
                            : null);

                    if (!finalCustomerKey) {
                        setError("고객 정보를 찾을 수 없습니다");
                        return;
                    }

                    const confirmRes = await fetch("/api/payment/confirm", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ paymentKey, orderId, amount: Number(amount), userId: resolvedUserId, billingCycle }),
                    });
                    const confirmData = await confirmRes.json();

                    if (!confirmRes.ok) {
                        setError(confirmData.error || "결제 승인 실패");
                        return;
                    }

                    if (paymentKey.startsWith("tlink") || paymentKey.startsWith("tviva")) {
                        setResult({ success: true, data: confirmData.data });
                        setError("⚠️ 카드 직접 결제만 구독이 가능합니다. 결제는 완료되었으나 자동결제는 등록되지 않았습니다.");
                        return;
                    }

                    const billingRes = await fetch("/api/billing/issue-from-payment", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ paymentKey, customerKey: finalCustomerKey, userId: resolvedUserId, amount: Number(amount), orderName, billingCycle }),
                    });
                    const billingData = await billingRes.json();

                    if (!billingRes.ok) {
                        setResult({ success: true, data: confirmData.data });
                        return;
                    }

                    setResult({ success: true, data: confirmData.data, subscription: billingData.subscription, billingKey: billingData.billingKey });
                    return;
                }

                if (isRecurring && authKey && customerKey) {
                    const billingRes = await fetch("/api/billing/issue", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ authKey, customerKey, userId: resolvedUserId, amount: Number(amount), orderName, billingCycle }),
                    });
                    const billingData = await billingRes.json();

                    if (!billingRes.ok) {
                        setError(billingData.error || "빌링키 발급 실패");
                        return;
                    }

                    setResult({
                        success: true,
                        data: { orderId: `sub_${Date.now()}`, totalAmount: amount, method: "카드 (자동결제 등록)" },
                        subscription: billingData.subscription,
                        billingKey: billingData.billingKey,
                    });
                    setLoading(false);
                    return;
                }

                if (!paymentKey || !orderId || !amount) {
                    setError("결제 정보가 누락되었습니다");
                    return;
                }

                const res = await fetch("/api/payment/confirm", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ paymentKey, orderId, amount: Number(amount), userId: resolvedUserId, billingCycle }),
                });
                const data = await res.json();

                if (!res.ok) {
                    setError(data.error || "결제 승인 실패");
                    return;
                }

                setResult(data);
            } catch {
                setError("결제 처리 중 오류가 발생했습니다");
            } finally {
                setLoading(false);
            }
        };

        confirm();
    }, [authLoading]);

    if (loading) return <Loading />;
    if (error) return <Fail error={error} onRetry={() => router.push("/")} />;
    return <Success result={result} />;
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
    spinner: {
        width: 36,
        height: 36,
        border: "3px solid #333",
        borderTop: "3px solid #ededed",
        borderRadius: "50%",
        animation: "spin 1s linear infinite",
        margin: "0 auto 16px",
    },
    loadingTitle: {
        fontSize: 16,
        fontWeight: 500,
        color: "#ededed",
        marginBottom: 4,
    },
    loadingDesc: {
        fontSize: 13,
        color: "#888",
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
    divider: {
        height: 1,
        background: "#2e2e2e",
        margin: "20px 0",
    },
    infoRow: {
        display: "flex",
        justifyContent: "space-between",
        marginBottom: 10,
        fontSize: 13,
    },
    label: {
        color: "#666",
    },
    value: {
        fontWeight: 500,
        color: "#ededed",
    },
    valueHighlight: {
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
