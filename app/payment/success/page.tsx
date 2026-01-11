"use client";
import React, { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/context/AuthContext";

export default function PaymentSuccessPage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { user } = useAuth();
    const [loading, setLoading] = useState(true);
    const [result, setResult] = useState<any>(null);
    const [error, setError] = useState("");

    useEffect(() => {
        const confirmPayment = async () => {
            try {
                const isBilling = searchParams?.get("billing") === "true";
                const authKey = searchParams?.get("authKey");
                const customerKey = searchParams?.get("customerKey");

                // Billing auth (recurring subscription)
                if (isBilling && authKey && customerKey) {
                    const amount = searchParams?.get("amount");
                    const orderName = searchParams?.get("orderName");

                    // Determine plan from order name
                    let plan: "free" | "plus" | "pro" = "free";
                    if (orderName?.includes("플러스")) {
                        plan = "plus";
                    } else if (orderName?.includes("프로")) {
                        plan = "pro";
                    }

                    if (!user) {
                        setError("로그인이 필요합니다.");
                        return;
                    }

                    // Save billing key to Firebase
                    const billingResponse = await fetch(
                        "/api/payment/billing",
                        {
                            method: "POST",
                            headers: {
                                "Content-Type": "application/json",
                            },
                            body: JSON.stringify({
                                authKey,
                                customerKey,
                                userId: user.uid,
                                plan,
                                amount: Number(amount),
                            }),
                        }
                    );

                    const billingData = await billingResponse.json();

                    if (!billingResponse.ok) {
                        setError(
                            billingData.error || "구독 설정에 실패했습니다."
                        );
                        return;
                    }

                    setResult({
                        type: "subscription",
                        plan,
                        amount: Number(amount),
                        orderName,
                        message: "구독이 시작되었습니다.",
                    });
                    return;
                }

                // One-time payment
                const paymentKey = searchParams?.get("paymentKey");
                const orderId = searchParams?.get("orderId");
                const amount = searchParams?.get("amount");

                if (!paymentKey || !orderId || !amount) {
                    setError("결제 정보가 불완전합니다.");
                    return;
                }

                const response = await fetch("/api/payment/confirm", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        paymentKey,
                        orderId,
                        amount: Number(amount),
                    }),
                });

                const data = await response.json();

                if (!response.ok) {
                    setError(data.error || "결제 승인에 실패했습니다.");
                    return;
                }

                setResult({ type: "payment", ...data.data });
            } catch (err) {
                setError("결제 처리 중 오류가 발생했습니다.");
                console.error(err);
            } finally {
                setLoading(false);
            }
        };

        confirmPayment();
    }, [searchParams, user]);

    if (loading) {
        return (
            <div
                style={{
                    minHeight: "100vh",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: "#000",
                }}
            >
                <div style={{ textAlign: "center", color: "#fff" }}>
                    <div
                        style={{
                            fontSize: 48,
                            marginBottom: 16,
                            animation: "spin 1s linear infinite",
                        }}
                    >
                        ⏳
                    </div>
                    <h2
                        style={{
                            marginBottom: 8,
                            fontSize: 24,
                            fontWeight: 600,
                        }}
                    >
                        결제 처리 중입니다
                    </h2>
                    <p style={{ opacity: 0.9, fontSize: 14 }}>
                        잠시만 기다려주세요...
                    </p>
                    <style>{`
            @keyframes spin {
              from { transform: rotate(0deg); }
              to { transform: rotate(360deg); }
            }
          `}</style>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div
                style={{
                    minHeight: "100vh",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: "#000",
                    padding: "20px",
                }}
            >
                <div
                    style={{
                        maxWidth: 480,
                        width: "100%",
                        background: "#fff",
                        borderRadius: 20,
                        padding: 40,
                        boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
                        textAlign: "center",
                    }}
                >
                    <div style={{ fontSize: 60, marginBottom: 20 }}>❌</div>
                    <h2
                        style={{
                            color: "#d32f2f",
                            marginBottom: 16,
                            fontSize: 24,
                            fontWeight: 700,
                        }}
                    >
                        결제 실패
                    </h2>
                    <p
                        style={{
                            color: "#666",
                            marginBottom: 30,
                            fontSize: 16,
                            lineHeight: 1.5,
                        }}
                    >
                        {error}
                    </p>
                    <button
                        onClick={() => router.push("/payment")}
                        style={{
                            width: "100%",
                            padding: "14px 20px",
                            background: "#0164ff",
                            color: "#fff",
                            border: "none",
                            borderRadius: 10,
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
                        다시 결제하기
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div
            style={{
                minHeight: "100vh",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "#000",
                padding: "20px",
            }}
        >
            <div
                style={{
                    maxWidth: 500,
                    width: "100%",
                    background: "#fff",
                    borderRadius: 20,
                    padding: "50px 40px",
                    boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
                }}
            >
                {/* Success Icon */}
                <div style={{ textAlign: "center", marginBottom: 30 }}>
                    <div
                        style={{
                            width: 80,
                            height: 80,
                            background: "#0164ff",
                            borderRadius: "50%",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            margin: "0 auto",
                            animation: "scaleIn 0.5s ease-out",
                        }}
                    >
                        <svg
                            width="48"
                            height="48"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="#fff"
                            strokeWidth="3"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        >
                            <polyline points="20 6 9 17 4 12" />
                        </svg>
                    </div>
                </div>

                {/* Title */}
                <h1
                    style={{
                        textAlign: "center",
                        fontSize: 28,
                        fontWeight: 700,
                        color: "#1a1a1a",
                        marginBottom: 10,
                    }}
                >
                    결제가 완료되었습니다
                </h1>
                <p
                    style={{
                        textAlign: "center",
                        fontSize: 14,
                        color: "#999",
                        marginBottom: 40,
                    }}
                >
                    감사합니다. 고객님의 결제가 성공적으로 처리되었습니다.
                    <br />
                    Nova AI와 함께 더 효율적인 한글 문서 작업을 시작해보세요!
                </p>

                {/* Payment Info Card */}
                <div
                    style={{
                        background: "#f8f9fa",
                        borderRadius: 12,
                        padding: 24,
                        marginBottom: 30,
                        border: "1px solid #e9ecef",
                    }}
                >
                    <div style={{ marginBottom: 20 }}>
                        <span
                            style={{
                                display: "block",
                                fontSize: 12,
                                color: "#999",
                                marginBottom: 6,
                                fontWeight: 500,
                            }}
                        >
                            주문번호
                        </span>
                        <span
                            style={{
                                display: "block",
                                fontSize: 16,
                                fontWeight: 600,
                                color: "#1a1a1a",
                                wordBreak: "break-all",
                            }}
                        >
                            {result?.orderId}
                        </span>
                    </div>

                    <div style={{ marginBottom: 20 }}>
                        <span
                            style={{
                                display: "block",
                                fontSize: 12,
                                color: "#999",
                                marginBottom: 6,
                                fontWeight: 500,
                            }}
                        >
                            결제금액
                        </span>
                        <span
                            style={{
                                display: "block",
                                fontSize: 24,
                                fontWeight: 700,
                                color: "#0164ff",
                            }}
                        >
                            {(result?.totalAmount || 0).toLocaleString()}원
                        </span>
                    </div>

                    <div style={{ marginBottom: 20 }}>
                        <span
                            style={{
                                display: "block",
                                fontSize: 12,
                                color: "#999",
                                marginBottom: 6,
                                fontWeight: 500,
                            }}
                        >
                            결제수단
                        </span>
                        <span
                            style={{
                                display: "block",
                                fontSize: 14,
                                fontWeight: 600,
                                color: "#1a1a1a",
                            }}
                        >
                            {result?.method === "CARD"
                                ? "카드"
                                : result?.method === "TRANSFER"
                                ? "계좌이체"
                                : result?.method || "결제"}
                        </span>
                    </div>

                    <div>
                        <span
                            style={{
                                display: "block",
                                fontSize: 12,
                                color: "#999",
                                marginBottom: 6,
                                fontWeight: 500,
                            }}
                        >
                            승인번호
                        </span>
                        <span
                            style={{
                                display: "block",
                                fontSize: 14,
                                fontWeight: 600,
                                color: "#1a1a1a",
                                fontFamily: "monospace",
                            }}
                        >
                            {result?.approvalNumber}
                        </span>
                    </div>
                </div>

                {/* Buttons */}
                <div style={{ display: "flex", gap: 12 }}>
                    <button
                        onClick={() => router.push("/")}
                        style={{
                            flex: 1,
                            padding: "14px 20px",
                            background: "#f8f9fa",
                            color: "#0164ff",
                            border: "2px solid #0164ff",
                            borderRadius: 10,
                            fontWeight: 600,
                            fontSize: 16,
                            cursor: "pointer",
                            transition: "all 0.3s",
                        }}
                        onMouseOver={(e) => {
                            e.currentTarget.style.background = "#0164ff";
                            e.currentTarget.style.color = "#fff";
                        }}
                        onMouseOut={(e) => {
                            e.currentTarget.style.background = "#f8f9fa";
                            e.currentTarget.style.color = "#0164ff";
                        }}
                    >
                        홈으로
                    </button>
                    <button
                        onClick={() => router.push("/download")}
                        style={{
                            flex: 1,
                            padding: "14px 20px",
                            background: "#0164ff",
                            color: "#fff",
                            border: "none",
                            borderRadius: 10,
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
                        다운로드
                    </button>
                </div>

                <style>{`
          @keyframes scaleIn {
            from {
              transform: scale(0.8);
              opacity: 0;
            }
            to {
              transform: scale(1);
              opacity: 1;
            }
          }
        `}</style>
            </div>
        </div>
    );
}
