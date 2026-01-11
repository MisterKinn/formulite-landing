"use client";

import React, { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import dynamic from "next/dynamic";
import { Navbar } from "../../../components/Navbar";
const Sidebar = dynamic(() => import("../../../components/Sidebar"), {
    ssr: false,
});
import "../../style.css";
import "../../mobile.css";

/* -------------------- Loading -------------------- */
function Loading() {
    return (
        <div style={styles.fullscreen}>
            <div style={styles.loadingCard}>
                <div style={styles.spinner} />
                <h2 style={styles.loadingTitle}>결제 처리 중</h2>
                <p style={styles.loadingDesc}>잠시만 기다려주세요</p>
            </div>
        </div>
    );
}

/* -------------------- Fail -------------------- */
function Fail({ error, onRetry }: { error: string; onRetry: () => void }) {
    return (
        <div style={styles.fullscreen}>
            <div style={styles.card}>
                <div style={styles.failIcon}>✕</div>
                <h1 style={styles.title}>결제에 실패했습니다</h1>
                <p style={styles.desc}>{error}</p>
                <button style={styles.primaryButton} onClick={onRetry}>
                    다시 결제하기
                </button>
            </div>
        </div>
    );
}

/* -------------------- Success -------------------- */
function Success({ result }: { result: any }) {
    const orderId = result?.data?.orderId ?? "-";
    const method = result?.data?.method ?? "-";
    const amount = Number(
        result?.data?.totalAmount ?? result?.data?.amount ?? 0
    );

    return (
        <div style={styles.fullscreen}>
            <div style={styles.card}>
                <div style={styles.successIcon}>
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
                        <path
                            d="M20 6L9 17l-5-5"
                            stroke="#fff"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        />
                    </svg>
                </div>

                <h1 style={styles.title}>결제가 완료되었습니다</h1>
                <p style={styles.desc}>
                    결제가 정상적으로 처리되었습니다.
                    <br />
                    Nova AI와 함께 더 효율적인 한글 문서 작성을 경험해보세요.
                </p>

                <div style={styles.divider} />

                <div style={styles.infoRow}>
                    <span style={styles.label}>주문번호</span>
                    <span style={styles.value}>{orderId}</span>
                </div>

                <div style={styles.infoRow}>
                    <span style={styles.label}>결제금액</span>
                    <span style={styles.value}>
                        {amount.toLocaleString()}원
                    </span>
                </div>

                <div style={styles.infoRow}>
                    <span style={styles.label}>결제수단</span>
                    <span style={styles.value}>{method}</span>
                </div>

                <button
                    style={{ ...styles.primaryButton, marginTop: 32 }}
                    onClick={() => (window.location.href = "/")}
                >
                    홈으로 이동
                </button>
            </div>
        </div>
    );
}

/* -------------------- Page -------------------- */
export default function PaymentSuccessPage() {
    return (
        <>
            <Navbar />
            <Sidebar />
            <React.Suspense fallback={<Loading />}>
                <PaymentSuccessContent />
            </React.Suspense>
        </>
    );
}

function PaymentSuccessContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { loading: authLoading } = useAuth();

    const confirmedRef = useRef(false);
    const [loading, setLoading] = useState(true);
    const [result, setResult] = useState<any>(null);
    const [error, setError] = useState("");

    useEffect(() => {
        if (authLoading || confirmedRef.current) return;
        confirmedRef.current = true;

        const confirm = async () => {
            try {
                const paymentKey = searchParams.get("paymentKey");
                const orderId = searchParams.get("orderId");
                const amount = searchParams.get("amount");

                if (!paymentKey || !orderId || !amount) {
                    setError("결제 정보가 누락되었습니다");
                    return;
                }

                const res = await fetch("/api/payment/confirm", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        paymentKey,
                        orderId,
                        amount: Number(amount),
                    }),
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
    if (error)
        return <Fail error={error} onRetry={() => router.push("/payment")} />;

    return <Success result={result} />;
}

/* -------------------- Styles -------------------- */
const styles: Record<string, React.CSSProperties> = {
    fullscreen: {
        minHeight: "100vh",
        background: "#000",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
    },
    card: {
        width: "100%",
        maxWidth: 420,
        background: "#fff",
        borderRadius: 20,
        padding: "36px 28px",
        textAlign: "center",
        boxShadow: "0 20px 40px rgba(0,0,0,0.2)",
    },
    loadingCard: {
        textAlign: "center",
        color: "#fff",
    },
    spinner: {
        width: 48,
        height: 48,
        border: "4px solid rgba(255,255,255,0.2)",
        borderTop: "4px solid #fff",
        borderRadius: "50%",
        animation: "spin 1s linear infinite",
        margin: "0 auto 16px",
    },
    loadingTitle: {
        fontSize: 20,
        fontWeight: 700,
        marginBottom: 4,
    },
    loadingDesc: {
        fontSize: 14,
        opacity: 0.7,
    },
    successIcon: {
        width: 64,
        height: 64,
        borderRadius: "50%",
        background: "#0164ff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        margin: "0 auto 20px",
    },
    failIcon: {
        fontSize: 48,
        color: "#ff4d4f",
        marginBottom: 16,
    },
    title: {
        fontSize: 22,
        fontWeight: 800,
        marginBottom: 8,
        color: "#0b1220",
    },
    desc: {
        fontSize: 14,
        color: "#666",
        marginBottom: 20,
    },
    divider: {
        height: 1,
        background: "#eee",
        margin: "24px 0",
    },
    infoRow: {
        display: "flex",
        justifyContent: "space-between",
        marginBottom: 12,
        fontSize: 14,
    },
    label: {
        color: "#888",
    },
    value: {
        fontWeight: 600,
        color: "#0b1220",
        textAlign: "right",
    },
    primaryButton: {
        width: "100%",
        height: 48,
        background: "#0164ff",
        color: "#fff",
        border: "none",
        borderRadius: 12,
        fontSize: 15,
        fontWeight: 700,
        cursor: "pointer",
    },
};
