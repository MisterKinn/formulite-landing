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

// use `updateSubscription` from AuthContext (writes safely to Firestore client-side)
// import { saveSubscription } from "@/lib/subscription";
import { getFirestore, doc, getDoc } from "firebase/firestore";
import { app as firebaseApp } from "../../../firebaseConfig";

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
function Success({
    result,
    subscriptionSaved,
    resultSubscription,
}: {
    result: any;
    subscriptionSaved?: { userId: string; plan: string } | null;
    resultSubscription?: any | null;
}) {
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

                {subscriptionSaved ? (
                    <div
                        style={{
                            marginTop: 14,
                            textAlign: "center",
                            color: "#0b1220",
                        }}
                    >
                        🎉 구독이 정상적으로 저장되었습니다:{" "}
                        <strong>{subscriptionSaved.plan}</strong>
                    </div>
                ) : null}

                {/* Subscription card styled to match current design */}
                <div style={{ marginTop: 24 }}>
                    <h3 style={{ color: "#fff", marginBottom: 12 }}>
                        구독 정보
                    </h3>

                    {resultSubscription ? (
                        <div style={styles.subscriptionBox}>
                            <div
                                style={{
                                    display: "flex",
                                    justifyContent: "space-between",
                                    alignItems: "center",
                                }}
                            >
                                <div>
                                    <div
                                        style={{
                                            fontWeight: 800,
                                            color: "#fff",
                                            fontSize: 16,
                                        }}
                                    >
                                        {resultSubscription.plan === "plus"
                                            ? "플러스 플랜"
                                            : resultSubscription.plan === "pro"
                                            ? "프로 플랜"
                                            : "무료 플랜"}
                                    </div>
                                    {resultSubscription.startDate ? (
                                        <div
                                            style={{
                                                color: "#6b7280",
                                                marginTop: 6,
                                                fontSize: 13,
                                            }}
                                        >
                                            구독 시작일:{" "}
                                            {new Date(
                                                resultSubscription.startDate
                                            ).toLocaleDateString("ko-KR")}
                                        </div>
                                    ) : null}
                                </div>

                                <div style={{ textAlign: "right" }}>
                                    {resultSubscription.amount !== undefined ? (
                                        <div
                                            style={{
                                                color: "#0164ff",
                                                fontWeight: 800,
                                                fontSize: 18,
                                            }}
                                        >
                                            {Number(
                                                resultSubscription.amount
                                            ).toLocaleString()}
                                            원
                                        </div>
                                    ) : (
                                        <div style={{ color: "#6b7280" }}>
                                            0원
                                        </div>
                                    )}
                                    <div style={{ marginTop: 10 }}>
                                        <button
                                            style={styles.cancelButton}
                                            onClick={() =>
                                                alert(
                                                    "구독 취소 로직을 연결하세요"
                                                )
                                            }
                                        >
                                            구독 취소하기
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div style={{ color: "#9aa4b6" }}>
                            구독 정보가 없습니다.
                        </div>
                    )}
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

/* -------------------- Debug component -------------------- */

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
    const confirmedRef = useRef(false);
    const [loading, setLoading] = useState(true);
    const [result, setResult] = useState<any>(null);
    const [error, setError] = useState("");
    const [subscriptionSaved, setSubscriptionSaved] = useState<null | {
        userId: string;
        plan: string;
    }>(null);

    const { loading: authLoading, user, updateSubscription } = useAuth();
    const [resultSubscription, setResultSubscription] = useState<any | null>(
        null
    );

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

                // Immediately try to save subscription if we can identify the user
                (async () => {
                    try {
                        const toss = data?.data || data;
                        const total = Number(
                            toss?.totalAmount ?? toss?.amount ?? 0
                        );
                        const plan =
                            total >= 19900
                                ? "pro"
                                : total >= 9900
                                ? "plus"
                                : null;
                        const customerKey = toss?.customerKey;

                        let targetUserId = user?.uid;
                        if (!targetUserId && typeof customerKey === "string") {
                            const parts = customerKey.split("_");
                            if (parts.length > 1) targetUserId = parts[1];
                        }

                        if (user && updateSubscription && plan) {
                            try {
                                await updateSubscription({
                                    plan: plan as any,
                                    amount: total,
                                    startDate: new Date().toISOString(),
                                    status: "active",
                                    customerKey,
                                });
                                console.log(
                                    `Saved subscription for ${user.uid} -> ${plan}`
                                );
                                setSubscriptionSaved({
                                    userId: user.uid,
                                    plan,
                                });
                            } catch (err) {
                                console.error(
                                    "Failed to update subscription via auth context:",
                                    err
                                );
                            }
                        } else if (targetUserId && plan) {
                            // fallback: request the admin API (requires ADMIN_SECRET in env)
                            try {
                                const adminSecret =
                                    (window as any).NEXT_PUBLIC_ADMIN_SECRET ||
                                    process.env.NEXT_PUBLIC_ADMIN_SECRET ||
                                    "";
                                if (!adminSecret)
                                    throw new Error(
                                        "No admin secret available"
                                    );

                                await fetch("/api/admin/set-subscription", {
                                    method: "POST",
                                    headers: {
                                        "Content-Type": "application/json",
                                        "x-admin-secret": adminSecret,
                                    },
                                    body: JSON.stringify({
                                        userId: targetUserId,
                                        subscription: {
                                            plan: plan as any,
                                            amount: total,
                                            startDate: new Date().toISOString(),
                                            status: "active",
                                            customerKey,
                                        },
                                    }),
                                });
                                console.log(
                                    `Requested server-side subscription for ${targetUserId} -> ${plan}`
                                );
                                setSubscriptionSaved({
                                    userId: targetUserId,
                                    plan,
                                });
                            } catch (err) {
                                console.error(
                                    "Failed to request server subscription:",
                                    err
                                );
                            }
                        }
                    } catch (err) {
                        console.error(
                            "Failed to save subscription on success page:",
                            err
                        );
                    }
                })();
            } catch {
                setError("결제 처리 중 오류가 발생했습니다");
            } finally {
                setLoading(false);
            }
        };

        confirm();
    }, [authLoading]);

    // After confirming and when user is available, fetch subscription from Firestore
    useEffect(() => {
        if (loading) return;
        if (!user) return;

        (async () => {
            try {
                const db = getFirestore(firebaseApp);
                const snap = await getDoc(doc(db, "users", user.uid));
                if (snap.exists()) {
                    const sub = (snap.data() as any).subscription ?? null;
                    setResultSubscription(sub);
                }
            } catch (err) {
                console.error("Failed to fetch subscription:", err);
            }
        })();
    }, [loading, user]);

    if (loading) return <Loading />;
    if (error)
        return <Fail error={error} onRetry={() => router.push("/payment")} />;

    return (
        <Success
            result={result}
            subscriptionSaved={subscriptionSaved}
            resultSubscription={resultSubscription}
        />
    );
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
    subscriptionBox: {
        background: "#0b0c10",
        borderRadius: 12,
        padding: "18px 20px",
        boxShadow: "0 12px 36px rgba(2,6,23,0.6)",
    },
    cancelButton: {
        background: "transparent",
        color: "#fff",
        border: "1px solid rgba(255,255,255,0.06)",
        padding: "8px 12px",
        borderRadius: 10,
        cursor: "pointer",
        fontWeight: 700,
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
