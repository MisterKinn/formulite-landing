"use client";
import React, { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

// Toss Payments SDK 타입
declare global {
    interface Window {
        TossPayments: any;
    }
}

export default function PaymentPage() {
    const searchParams = useSearchParams();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    // sdkLoaded 제거: TossPayments SDK는 layout.tsx에서 전역으로 삽입됨

    // 기본값 (URL 파라미터로 오버라이드 가능)
    const PAYMENT_AMOUNT = Number(searchParams?.get("amount")) || 10000;
    const CUSTOMER_NAME = searchParams?.get("name") || "Nova AI Customer";
    const CUSTOMER_EMAIL =
        searchParams?.get("email") || "customer@formulite.ai";
    const ORDER_NAME = searchParams?.get("orderName") || "Nova AI 구독";
    const IS_RECURRING = searchParams?.get("recurring") === "true"; // 월간 구독 여부

    // TossPayments SDK가 window에 없으면 새로고침
    useEffect(() => {
        if (!window.TossPayments || typeof window.TossPayments !== "function") {
            window.location.reload();
        } else {
            // SDK가 있으면 결제 진행
            if (IS_RECURRING) {
                handleRecurringPayment();
            } else {
                handleAutoPayment();
            }
        }
    }, []);

    // sdkLoaded 관련 로직 제거

    // 일회성 결제
    const handleAutoPayment = async () => {
        try {
            if (!window.TossPayments) {
                throw new Error("결제 SDK를 사용할 수 없습니다.");
            }

            const clientKey = process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY;
            if (!clientKey) {
                throw new Error("결제 설정이 올바르지 않습니다.");
            }

            const tossPayments = window.TossPayments(clientKey);
            const orderId = `order_${Date.now()}`;
            const customerKey = `customer_${CUSTOMER_EMAIL}_${Date.now()}`;

            const payment = tossPayments.payment({
                customerKey: customerKey,
            });

            await payment.requestPayment({
                method: "CARD",
                amount: {
                    currency: "KRW",
                    value: PAYMENT_AMOUNT,
                },
                orderId,
                orderName: ORDER_NAME,
                customerName: CUSTOMER_NAME,
                customerEmail: CUSTOMER_EMAIL,
                successUrl: `${window.location.origin}/payment/success`,
                failUrl: `${window.location.origin}/payment/fail`,
            });
        } catch (error: any) {
            console.error("결제 오류:", error);
            setError(error?.message || "결제 요청에 실패했습니다.");
            setLoading(false);
        }
    };

    // 월간 구독 결제 (빌링키 발급)
    const handleRecurringPayment = async () => {
        try {
            if (!window.TossPayments) {
                throw new Error("결제 SDK를 사용할 수 없습니다.");
            }

            const clientKey = process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY;
            if (!clientKey) {
                throw new Error("결제 설정이 올바르지 않습니다.");
            }

            const tossPayments = window.TossPayments(clientKey);
            if (typeof tossPayments.requestBillingAuth !== "function") {
                throw new Error(
                    "SDK 함수(requestBillingAuth)가 없습니다. TossPayments SDK 버전 또는 로드 문제입니다."
                );
            }

            const customerKey = `customer_${CUSTOMER_EMAIL}_${Date.now()}`;

            await tossPayments.requestBillingAuth("카드", {
                customerKey: customerKey,
                successUrl: `${
                    window.location.origin
                }/payment/success?billing=true&amount=${PAYMENT_AMOUNT}&orderName=${encodeURIComponent(
                    ORDER_NAME
                )}`,
                failUrl: `${window.location.origin}/payment/fail`,
            });
        } catch (error: any) {
            console.error("결제 오류:", error);
            setError(error?.message || "결제 요청에 실패했습니다.");
            setLoading(false);
        }
    };

    // Hide nextjs-portal on payment page
    React.useEffect(() => {
        const style = document.createElement("style");
        style.innerHTML = `nextjs-portal { display: none; }`;
        document.head.appendChild(style);
        return () => {
            document.head.removeChild(style);
        };
    }, []);

    // 로딩 화면
    return (
        <div
            style={{
                minHeight: "100vh",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "#000",
                overflow: "hidden",
            }}
        >
            <div style={{ textAlign: "center", color: "#fff" }}>
                {error ? (
                    <>
                        <div style={{ fontSize: 60, marginBottom: 20 }}>❌</div>
                        <h2
                            style={{
                                fontSize: 24,
                                marginBottom: 16,
                                fontWeight: 700,
                            }}
                        >
                            결제 오류
                        </h2>
                        <p
                            style={{
                                fontSize: 16,
                                marginBottom: 30,
                                opacity: 0.9,
                            }}
                        >
                            {error}
                        </p>
                        <button
                            onClick={() => window.location.reload()}
                            style={{
                                padding: "12px 32px",
                                background: "#fff",
                                color: "#667eea",
                                border: "none",
                                borderRadius: 8,
                                fontWeight: 600,
                                fontSize: 16,
                                cursor: "pointer",
                                transition: "transform 0.2s",
                            }}
                            onMouseOver={(e) =>
                                (e.currentTarget.style.transform =
                                    "translateY(-2px)")
                            }
                            onMouseOut={(e) =>
                                (e.currentTarget.style.transform = "none")
                            }
                        >
                            다시 시도
                        </button>
                    </>
                ) : (
                    <>
                        <div
                            style={{
                                fontSize: 48,
                                marginBottom: 20,
                                animation: "spin 1.5s linear infinite",
                            }}
                        >
                            ⏳
                        </div>
                        <h2
                            style={{
                                fontSize: 24,
                                marginBottom: 8,
                                fontWeight: 600,
                            }}
                        >
                            {IS_RECURRING
                                ? "구독 결제 준비 중"
                                : "결제 창을 열고 있습니다"}
                        </h2>
                        <p style={{ fontSize: 14, opacity: 0.9 }}>
                            {IS_RECURRING
                                ? "카드 등록이 진행됩니다..."
                                : "결제 창이 자동으로 열립니다..."}
                        </p>
                        <style>{`
                            @keyframes spin {
                                from { transform: rotate(0deg); }
                                to { transform: rotate(360deg); }
                            }
                        `}</style>
                    </>
                )}
            </div>
        </div>
    );
}
