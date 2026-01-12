"use client";

import React, { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/context/AuthContext";

declare global {
    interface Window {
        PaymentWidget: any;
    }
}

export default function PaymentClient() {
    const searchParams = useSearchParams();

    const amount = Number(searchParams.get("amount") || 9900);
    const orderName = searchParams.get("orderName") || "Nova AI 결제";
    const recurring = searchParams.get("recurring") === "true";
    const billingCycle = (searchParams.get("billingCycle") as "monthly" | "yearly") || "monthly";

    const widgetRef = useRef<any>(null);
    const [ready, setReady] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const { user } = useAuth();

    // diagnostics and reload control
    const [debugInfo, setDebugInfo] = useState<any | null>(null);
    const [checkingStatus, setCheckingStatus] = useState(false);
    const [loadKey, setLoadKey] = useState(0);

    useEffect(() => {
        const init = async () => {
            try {
                if (!document.getElementById("toss-sdk")) {
                    const script = document.createElement("script");
                    script.id = "toss-sdk";
                    script.src =
                        "https://js.tosspayments.com/v1/payment-widget";
                    script.async = true;

                    await new Promise<void>((resolve, reject) => {
                        script.onload = () => resolve();
                        script.onerror = () =>
                            reject(new Error("SDK load failed"));
                        document.head.appendChild(script);
                    });
                }

                if (!window.PaymentWidget) {
                    throw new Error("PaymentWidget not available");
                }

                const uid = user?.uid;
                const customerKey = uid
                    ? `customer_${uid}_${Date.now()}`
                    : `guest_${Date.now()}`;
                console.debug("[PaymentClient] customerKey:", customerKey);

                const widget = window.PaymentWidget(
                    process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY!,
                    customerKey
                );

                // 모든 결제수단 (토스페이 + 카드 + 간편결제)
                widget.renderPaymentMethods(
                    "#payment-method",
                    { value: amount },
                    { variant: "DEFAULT" }
                );

                widget.renderAgreement("#payment-agreement");

                widgetRef.current = widget;
                setReady(true);
            } catch (e: any) {
                setError(e.message || "초기화 실패");
            }
        };

        init();
    }, [amount, loadKey]);

    async function checkScriptStatus() {
        setCheckingStatus(true);
        try {
            const res = await fetch("/api/toss-script");
            const json = await res.json();
            setDebugInfo(json);
            setError(json.status ? `스크립트 상태: ${json.status}` : null);
            return json;
        } catch (err) {
            const msg = String(err ?? "unknown");
            setDebugInfo({ error: msg });
            setError("상태 확인 실패: " + msg);
            return { ok: false, error: msg };
        } finally {
            setCheckingStatus(false);
        }
    }

    function retryLoad() {
        setError(null);
        setReady(false);
        setDebugInfo(null);
        setLoadKey((k) => k + 1);
    }

    const handlePay = () => {
        if (!widgetRef.current) return;

        const orderId = "order_" + Date.now();

        if (recurring && widgetRef.current.requestBillingAuth) {
            // initiate billing authorization (recurring) flow
            widgetRef.current.requestBillingAuth({
                orderId,
                orderName,
                // include a query so success page knows this was recurring
                successUrl: `${window.location.origin}/payment/success?recurring=true&billingCycle=${billingCycle}`,
                failUrl: `${window.location.origin}/payment/fail`,
            });
            return;
        }

        // fallback / one-time payment
        widgetRef.current.requestPayment({
            orderId,
            orderName,
            successUrl: `${window.location.origin}/payment/success`,
            failUrl: `${window.location.origin}/payment/fail`,
        });
    };

    if (error) {
        return (
            <div style={center}>
                <div
                    style={{
                        width: 520,
                        maxWidth: "94vw",
                        background: "#ffffff",
                        color: "#0b1220",
                        borderRadius: 16,
                        padding: 24,
                        boxShadow: "0 12px 40px rgba(2,6,23,0.08)",
                        textAlign: "center",
                    }}
                >
                    <div style={{ fontSize: 40, marginBottom: 12 }}>❌</div>
                    <h2 style={{ marginBottom: 8 }}>결제 오류</h2>
                    <p style={{ color: "#0b1220", marginBottom: 16 }}>
                        {error}
                    </p>
                    <div
                        style={{
                            display: "flex",
                            gap: 8,
                            justifyContent: "center",
                        }}
                    >
                        <button
                            onClick={retryLoad}
                            style={{
                                padding: "10px 18px",
                                borderRadius: 8,
                                border: "none",
                                background: "#111",
                                color: "#fff",
                                cursor: "pointer",
                                boxShadow: "inset 0 0 0 1px #222",
                            }}
                        >
                            재시도
                        </button>
                        <button
                            onClick={checkScriptStatus}
                            style={{
                                padding: "10px 18px",
                                borderRadius: 8,
                                border: "2px solid #444",
                                background: "#222",
                                color: "#fff",
                                cursor: "pointer",
                            }}
                        >
                            상태 확인
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div style={container}>
            <div style={card}>
                <h1
                    style={{
                        marginBottom: 12,
                        textAlign: "center",
                        color: "#0b1220",
                        fontSize: 36,
                        fontWeight: 900,
                    }}
                >
                    {orderName}
                </h1>

                {/* 토스가 제공하는 실제 결제 UI */}
                <div
                    id="payment-method"
                    style={{
                        marginTop: 8,
                        marginBottom: 8,
                        padding: 10,
                        borderRadius: 12,
                        background: "#ffffff",
                        minHeight: 48,
                    }}
                />
                <div
                    id="payment-agreement"
                    style={{
                        marginTop: 8,
                        padding: 8,
                        borderRadius: 10,
                        background: "#ffffff",
                        minHeight: 40,
                    }}
                />

                {/* 단 하나의 액션 */}
                <button
                    onClick={handlePay}
                    disabled={!ready}
                    style={{
                        width: "100%",
                        marginTop: 12,
                        padding: "14px 0",
                        fontSize: 16,
                        fontWeight: 800,
                        borderRadius: 12,
                        border: "none",
                        background: ready ? "#0164ff" : "#1f2937",
                        color: "#fff",
                        cursor: ready ? "pointer" : "not-allowed",
                        boxShadow: ready
                            ? "0 12px 32px rgba(1,100,255,0.18)"
                            : "none",
                    }}
                >
                    {ready
                        ? (recurring
                            ? `${amount.toLocaleString()}원 · 정기 결제 등록 (${billingCycle === 'yearly' ? '연간' : '월간'})`
                            : `${amount.toLocaleString()}원 결제하기`)
                        : "로딩 중..."}
                </button>
            </div>
        </div>
    );
}

/* styles */
const container: React.CSSProperties = {
    minHeight: "100vh",
    background: "#050506",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    color: "#fff",
};

const card: React.CSSProperties = {
    width: 520,
    background: "#ffffff",
    color: "#0b1220",
    borderRadius: 16,
    padding: 20,
    boxShadow: "0 12px 40px rgba(2,6,23,0.08)",
};

const center: React.CSSProperties = {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
};
