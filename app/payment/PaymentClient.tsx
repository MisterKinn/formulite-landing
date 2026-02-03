"use client";

import React, { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { loadTossPayments } from "@tosspayments/tosspayments-sdk";

export default function PaymentClient() {
    const searchParams = useSearchParams();
    const { user } = useAuth();

    const amount = Number(searchParams.get("amount") || 49900);
    const orderName = searchParams.get("orderName") || "Nova AI 프로";
    const recurring = searchParams.get("recurring") === "true";
    const billingCycle =
        (searchParams.get("billingCycle") as "monthly" | "yearly" | "test") ||
        "monthly";

    const paymentRef = useRef<any>(null);

    const [ready, setReady] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [currentCustomerKey, setCurrentCustomerKey] = useState("");
    const [reloadKey, setReloadKey] = useState(0);

    /* ---------------- SDK INIT ---------------- */
    useEffect(() => {
        const init = async () => {
            try {
                if (!user?.uid) return;

                const customerKey = `user_${user.uid
                    .replace(/[^a-zA-Z0-9\\-_=.@]/g, "")
                    .substring(0, 40)}`;

                setCurrentCustomerKey(customerKey);

                // 빌링(정기결제)인 경우 빌링용 클라이언트 키 사용, 아니면 일반 결제용 키 사용
                const clientKey = recurring
                    ? process.env.NEXT_PUBLIC_TOSS_BILLING_CLIENT_KEY!
                    : process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY!;

                const tossPayments = await loadTossPayments(clientKey);

                const payment = tossPayments.payment({
                    customerKey,
                });

                paymentRef.current = payment;
                setReady(true);
            } catch (e: any) {
                setError(e.message || "결제 초기화 실패");
            }
        };

        init();
    }, [reloadKey, recurring, user]);

    /* ---------------- PAY ---------------- */
    const handlePay = async () => {
        if (!user) {
            setError("로그인이 필요합니다.");
            return;
        }

        const orderId = `${recurring ? "billing" : "order"}_${Date.now()}`;

        try {
            if (!paymentRef.current) {
                setError("결제 시스템이 준비되지 않았습니다.");
                return;
            }

            if (recurring) {
                await paymentRef.current.requestBillingAuth({
                    method: "CARD",
                    successUrl: `${
                        window.location.origin
                    }/payment/success?recurring=true&amount=${amount}&orderName=${encodeURIComponent(
                        orderName,
                    )}&billingCycle=${billingCycle}`,
                    failUrl: `${window.location.origin}/payment/fail`,
                    customerEmail: user.email,
                    customerName: user.displayName || "고객",
                });
            } else {
                await paymentRef.current.requestPayment({
                    method: "CARD",
                    amount: {
                        value: amount,
                        currency: "KRW",
                    },
                    orderId,
                    orderName,
                    successUrl: `${window.location.origin}/payment/success`,
                    failUrl: `${window.location.origin}/payment/fail`,
                    customerEmail: user.email || "test@example.com",
                    customerName: user.displayName || "고객",
                });
            }
        } catch (e: any) {
            setError(e.message || "결제 요청 실패");
        }
    };

    /* ---------------- ERROR ---------------- */
    if (error) {
        return (
            <div style={center}>
                <div style={errorCard}>
                    <h2>결제 오류</h2>
                    <p>{error}</p>
                    <button onClick={() => setReloadKey((k) => k + 1)}>
                        다시 시도
                    </button>
                </div>
            </div>
        );
    }

    /* ---------------- UI ---------------- */
    return (
        <div style={container}>
            <div style={card}>
                {/* 요금 요약 */}
                <div style={priceBox}>
                    <div style={planName}>{orderName}</div>
                    <div style={price}>
                        {amount.toLocaleString()}원
                        <span style={unit}> / 월</span>
                    </div>
                </div>

                {/* 안내 */}
                {recurring && (
                    <div style={infoBox}>
                        오늘 결제 시 카드가 등록되며
                        <br />
                        <strong>매달 같은 날짜에 자동 결제</strong>됩니다.
                        <div style={infoSub}>
                            카드 직접 결제만 가능 (간편결제 제외)
                        </div>
                    </div>
                )}

                {/* CTA */}
                <button
                    onClick={handlePay}
                    disabled={!ready}
                    style={{
                        ...ctaButton,
                        background: ready ? "#2563eb" : "#9ca3af",
                        cursor: ready ? "pointer" : "not-allowed",
                    }}
                >
                    {ready
                        ? `${amount.toLocaleString()}원 결제하고 구독 시작`
                        : "결제 준비 중..."}
                </button>
            </div>
        </div>
    );
}

/* ================= STYLES ================= */

const container: React.CSSProperties = {
    minHeight: "100dvh",
    background: "#050506",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
};

const card: React.CSSProperties = {
    width: 520,
    maxWidth: "94vw",
    background: "#ffffff",
    borderRadius: 20,
    padding: 24,
    boxShadow: "0 20px 50px rgba(0,0,0,0.15)",
};

const priceBox = {
    textAlign: "center" as const,
    paddingBottom: 16,
    borderBottom: "1px solid #e5e7eb",
};

const planName = {
    fontSize: 14,
    color: "#6b7280",
};

const price = {
    fontSize: 30,
    fontWeight: 800,
    marginTop: 6,
    color: "#000000",
};

const unit = {
    fontSize: 14,
    fontWeight: 500,
    color: "#6b7280",
};

const infoBox = {
    marginTop: 16,
    padding: 14,
    background: "#f9fafb",
    border: "1px solid #e5e7eb",
    borderRadius: 12,
    fontSize: 14,
    textAlign: "center" as const,
    lineHeight: 1.6,
    color: "#000000",
};

const infoSub = {
    marginTop: 6,
    fontSize: 12,
    color: "#9ca3af",
};

const section = {
    marginTop: 20,
};

const sectionTitle = {
    fontSize: 13,
    fontWeight: 600,
    color: "#6b7280",
    marginBottom: 8,
};

const widgetBox = {
    background: "#ffffff",
    borderRadius: 12,
    padding: 8,
};

const agreementBox = {
    background: "#ffffff",
    borderRadius: 10,
    padding: 8,
};

const ctaButton: React.CSSProperties = {
    width: "100%",
    marginTop: 24,
    padding: "16px 0",
    fontSize: 16,
    fontWeight: 700,
    borderRadius: 16,
    border: "none",
    color: "#ffffff",
};

const center = {
    minHeight: "100dvh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
};

const errorCard = {
    background: "#fff",
    padding: 24,
    borderRadius: 16,
    textAlign: "center" as const,
};
