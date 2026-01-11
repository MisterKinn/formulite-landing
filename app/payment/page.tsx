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
    return (
        <React.Suspense fallback={<div>Loading...</div>}>
            <PaymentContent />
        </React.Suspense>
    );
}

function PaymentContent() {
    const searchParams = useSearchParams();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    // 기본값 (URL 파라미터로 오버라이드 가능)
    const PAYMENT_AMOUNT = Number(searchParams?.get("amount")) || 10000;
    const CUSTOMER_NAME = searchParams?.get("name") || "Nova AI Customer";
    const CUSTOMER_EMAIL =
        searchParams?.get("email") || "customer@formulite.ai";
    const ORDER_NAME = searchParams?.get("orderName") || "Nova AI 구독";
    const IS_RECURRING = searchParams?.get("recurring") === "true";

    // 일회성 결제 핸들러 (구현 필요)
    const handleAutoPayment = async () => {
        // TossPayments 결제창 호출 로직 구현
        // ...
    };

    // 정기 결제 핸들러 (구현 필요)
    const handleRecurringPayment = async () => {
        // TossPayments 정기 결제창 호출 로직 구현
        // ...
    };

    useEffect(() => {
        const scriptTag = document.getElementById("toss-sdk-script");
        if (scriptTag) {
            // SDK script already present
        }
        if (!window.TossPayments || typeof window.TossPayments !== "function") {
            if (document.getElementById("toss-sdk-script")) {
                setError(
                    "결제 SDK를 불러올 수 없습니다. 네트워크 또는 브라우저 문제일 수 있습니다."
                );
                setLoading(false);
                return;
            }
            const script = document.createElement("script");
            script.id = "toss-sdk-script";
            script.src = "https://js.tosspayments.com/v2/payment-widget";
            script.async = true;
            script.onload = () => {
                if (
                    window.TossPayments &&
                    typeof window.TossPayments === "function"
                ) {
                    if (IS_RECURRING) {
                        handleRecurringPayment();
                    } else {
                        handleAutoPayment();
                    }
                } else {
                    setError(
                        "결제 SDK가 로드되었으나 window.TossPayments가 없습니다. SDK 버전 또는 네트워크 문제일 수 있습니다."
                    );
                    setLoading(false);
                }
            };
            script.onerror = () => {
                setError(
                    "결제 SDK 로드 실패. 네트워크 또는 브라우저 문제일 수 있습니다."
                );
                setLoading(false);
            };
            document.head.appendChild(script);
            return;
        }
        // SDK가 있으면 결제 진행
        if (IS_RECURRING) {
            handleRecurringPayment();
        } else {
            handleAutoPayment();
        }
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
