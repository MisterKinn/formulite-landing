"use client";

import React, { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/context/AuthContext";

declare global {
    interface Window {
        PaymentWidget: any;
        TossPayments: any;
    }
}

export default function PaymentClient() {
    const searchParams = useSearchParams();

    const amount = Number(searchParams.get("amount") || 9900);
    const orderName = searchParams.get("orderName") || "Nova AI 결제";
    const recurring = searchParams.get("recurring") === "true";
    const billingCycle =
        (searchParams.get("billingCycle") as "monthly" | "yearly") || "monthly";

    const widgetRef = useRef<any>(null);
    const tossPaymentsRef = useRef<any>(null);
    const [ready, setReady] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [currentCustomerKey, setCurrentCustomerKey] = useState<string>("");

    const { user } = useAuth();

    // diagnostics and reload control
    const [debugInfo, setDebugInfo] = useState<any | null>(null);
    const [checkingStatus, setCheckingStatus] = useState(false);
    const [loadKey, setLoadKey] = useState(0);

    useEffect(() => {
        const init = async () => {
            try {
                if (recurring) {
                    // 구독 결제: TossPayments SDK (빌링 인증용)
                    if (!document.getElementById("toss-payments-sdk")) {
                        const script = document.createElement("script");
                        script.id = "toss-payments-sdk";
                        script.src = "https://js.tosspayments.com/v1/payment";
                        script.async = true;

                        await new Promise<void>((resolve, reject) => {
                            script.onload = () => resolve();
                            script.onerror = (e) => {
                                console.error("Script load error:", e);
                                reject(
                                    new Error("TossPayments SDK load failed")
                                );
                            };
                            document.head.appendChild(script);
                        });
                    }

                    // Wait for SDK to be available
                    let attempts = 0;
                    while (!window.TossPayments && attempts < 20) {
                        await new Promise((resolve) =>
                            setTimeout(resolve, 100)
                        );
                        attempts++;
                    }

                    if (!window.TossPayments) {
                        console.error(
                            "TossPayments not available after",
                            attempts * 100,
                            "ms"
                        );
                        throw new Error("TossPayments SDK not available");
                    }

                    const uid = user?.uid;
                    const customerKey = uid
                        ? `user_${uid
                              .replace(/[^a-zA-Z0-9\-_=.@]/g, "")
                              .substring(0, 40)}`
                        : `guest_${Date.now()}_${Math.random()
                              .toString(36)
                              .substring(2, 15)}`;

                    const validCustomerKey =
                        customerKey.length >= 2
                            ? customerKey
                            : `temp_${Math.random()
                                  .toString(36)
                                  .substring(2, 12)}`;

                    setCurrentCustomerKey(validCustomerKey);

                    console.log("🔑 CustomerKey:", validCustomerKey);
                    console.log("📦 TossPayments SDK 초기화 (빌링 인증)");

                    const tossPayments = window.TossPayments(
                        process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY!
                    );
                    tossPaymentsRef.current = tossPayments;

                    console.log("✅ TossPayments 초기화 완료");
                    setReady(true);
                } else {
                    // 일회성 결제: PaymentWidget SDK
                    if (!document.getElementById("toss-widget-sdk")) {
                        const script = document.createElement("script");
                        script.id = "toss-widget-sdk";
                        script.src =
                            "https://js.tosspayments.com/v1/payment-widget";
                        script.async = true;

                        await new Promise<void>((resolve, reject) => {
                            script.onload = () => resolve();
                            script.onerror = () =>
                                reject(
                                    new Error("PaymentWidget SDK load failed")
                                );
                            document.head.appendChild(script);
                        });
                    }

                    await new Promise((resolve) => setTimeout(resolve, 1000));

                    if (!window.PaymentWidget) {
                        throw new Error("PaymentWidget not available");
                    }

                    const widget = await window.PaymentWidget(
                        process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY!,
                        window.PaymentWidget.ANONYMOUS
                    );

                    widgetRef.current = widget;

                    // 결제 수단 UI 렌더링
                    const renderUI = () => {
                        const paymentMethodElement =
                            document.getElementById("payment-method");
                        const paymentAgreementElement =
                            document.getElementById("payment-agreement");

                        if (paymentMethodElement) {
                            widget.renderPaymentMethods(
                                "#payment-method",
                                { value: amount },
                                { variant: "DEFAULT" }
                            );
                        }

                        if (paymentAgreementElement) {
                            widget.renderAgreement("#payment-agreement");
                        }
                    };

                    renderUI();
                    setTimeout(() => renderUI(), 500);

                    setReady(true);
                }
            } catch (e: any) {
                console.error("SDK init error:", e);
                setError(e.message || "초기화 실패");
            }
        };

        init();
    }, [amount, loadKey, user, recurring]);

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

    const handlePay = async () => {
        if (!user) {
            setError("로그인이 필요합니다.");
            return;
        }

        const orderId = (recurring ? "billing_" : "order_") + Date.now();

        console.log("═══════════════════════════════════════");
        console.log(recurring ? "🔄 카드 등록" : "💳 일회성 결제");
        console.log("   - 금액:", amount.toLocaleString(), "원");
        if (recurring) {
            console.log("   - CustomerKey:", currentCustomerKey);
        }
        console.log("═══════════════════════════════════════");

        try {
            if (recurring) {
                // 구독: requestBillingAuth로 카드 등록
                if (!tossPaymentsRef.current) {
                    setError("결제 시스템이 준비되지 않았습니다.");
                    return;
                }

                console.log("📞 requestBillingAuth('카드') 호출");

                await tossPaymentsRef.current.requestBillingAuth("카드", {
                    customerKey: currentCustomerKey,
                    successUrl: `${
                        window.location.origin
                    }/payment/success?recurring=true&amount=${amount}&orderName=${encodeURIComponent(
                        orderName
                    )}&billingCycle=${billingCycle}`,
                    failUrl: `${window.location.origin}/payment/fail`,
                    customerEmail: user.email || undefined,
                    customerName: user.displayName || undefined,
                });

                console.log("✅ 카드 등록창 호출 완료");
            } else {
                // 일회성 결제
                if (!widgetRef.current) {
                    setError("결제 시스템이 준비되지 않았습니다.");
                    return;
                }

                await widgetRef.current.requestPayment({
                    orderId,
                    orderName,
                    customerEmail: user.email || "test@example.com",
                    customerName: user.displayName || "고객",
                    successUrl: `${window.location.origin}/payment/success`,
                    failUrl: `${window.location.origin}/payment/fail?orderId=${orderId}`,
                });

                console.log("✅ 결제 요청 완료");
            }
        } catch (error: any) {
            console.error("❌ 실패:", error);
            setError(error.message || "요청에 실패했습니다");
        }
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

                {/* 결제 안내 */}
                <div
                    style={{
                        marginBottom: 16,
                        padding: 12,
                        backgroundColor: recurring ? "#f0fdf4" : "#f0f9ff",
                        border: `1px solid ${
                            recurring ? "#22c55e" : "#0ea5e9"
                        }`,
                        borderRadius: 8,
                        textAlign: "center",
                    }}
                >
                    <strong
                        style={{ color: recurring ? "#16a34a" : "#0369a1" }}
                    >
                        {recurring ? "🔄 월간 구독" : "💳 일회성 결제"}
                    </strong>
                    <p
                        style={{
                            margin: "4px 0 0 0",
                            fontSize: 14,
                            color: recurring ? "#166534" : "#0c4a6e",
                        }}
                    >
                        {recurring
                            ? `${amount.toLocaleString()}원 매월 자동결제`
                            : `${amount.toLocaleString()}원을 바로 결제합니다`}
                    </p>
                </div>

                {/* 구독 결제 안내 */}
                {recurring && (
                    <div
                        style={{
                            marginBottom: 16,
                            padding: 20,
                            backgroundColor: "#f8fafc",
                            border: "2px solid #e2e8f0",
                            borderRadius: 12,
                            textAlign: "center",
                        }}
                    >
                        <div style={{ fontSize: 48, marginBottom: 12 }}>💳</div>
                        <h3
                            style={{
                                marginBottom: 8,
                                color: "#1f2937",
                                fontWeight: 700,
                            }}
                        >
                            카드 등록
                        </h3>
                        <p
                            style={{
                                color: "#6b7280",
                                marginBottom: 8,
                                fontSize: 14,
                            }}
                        >
                            월간 구독을 위한 카드 정보를 등록합니다.
                        </p>
                        <p
                            style={{
                                color: "#ef4444",
                                marginBottom: 0,
                                fontSize: 13,
                                fontWeight: 600,
                            }}
                        >
                            ⚠️ 등록 후 즉시 첫 결제({amount.toLocaleString()}
                            원)가 진행됩니다
                        </p>
                    </div>
                )}

                {/* 일회성 결제만 결제 UI 표시 */}
                {!recurring && (
                    <>
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
                    </>
                )}

                {/* 구독 결제 UI 제거 - requestBillingAuth가 별도 창으로 띄움 */}

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
                        ? recurring
                            ? "카드 등록하고 구독 시작"
                            : `${amount.toLocaleString()}원 결제하기`
                        : "로딩 중..."}
                </button>
            </div>
        </div>
    );
}

/* styles */
const container: React.CSSProperties = {
    minHeight: "100dvh",
    background: "#050506",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 16,
    paddingLeft: 16,
    paddingRight: 16,
    paddingBottom: "max(16px, env(safe-area-inset-bottom))" as any,
    color: "#fff",
    overflowY: "auto",
};

const card: React.CSSProperties = {
    width: 520,
    maxWidth: "94vw",
    background: "#ffffff",
    color: "#0b1220",
    borderRadius: 16,
    padding: 20,
    boxShadow: "0 12px 40px rgba(2,6,23,0.08)",
};

const center: React.CSSProperties = {
    minHeight: "100dvh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 16,
    paddingLeft: 16,
    paddingRight: 16,
    paddingBottom: "max(16px, env(safe-area-inset-bottom))" as any,
    overflowY: "auto",
};
