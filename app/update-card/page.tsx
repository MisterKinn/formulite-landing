"use client";

import { Suspense, useEffect, useState, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { getAuth, onAuthStateChanged, User } from "firebase/auth";
import { getFirebaseAppOrNull } from "@/firebaseConfig";

function LoadingSpinner() {
    return (
        <div
            style={{
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                height: "100vh",
                background: "#f9fafb",
            }}
        >
            <div style={{ textAlign: "center" }}>
                <div
                    style={{
                        width: "40px",
                        height: "40px",
                        border: "3px solid #e5e7eb",
                        borderTopColor: "#2563eb",
                        borderRadius: "50%",
                        animation: "spin 1s linear infinite",
                        margin: "0 auto 1rem",
                    }}
                />
                <p style={{ color: "#6b7280" }}>로딩 중...</p>
                <style>{`
                    @keyframes spin {
                        to { transform: rotate(360deg); }
                    }
                `}</style>
            </div>
        </div>
    );
}

export default function UpdateCardPage() {
    return (
        <Suspense fallback={<LoadingSpinner />}>
            <UpdateCardContent />
        </Suspense>
    );
}

function UpdateCardContent() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [authUser, setAuthUser] = useState<User | null>(null);
    const initiatedRef = useRef(false);

    useEffect(() => {
        const firebaseApp = getFirebaseAppOrNull();
        if (!firebaseApp) {
            setAuthUser(null);
            setLoading(false);
            return;
        }
        const auth = getAuth(firebaseApp);
        const unsubscribe = onAuthStateChanged(auth, (user) => {
            setAuthUser(user);
            setLoading(false);
        });
        return () => unsubscribe();
    }, []);

    useEffect(() => {
        if (loading || !authUser || initiatedRef.current) return;

        const initTossPayments = async () => {
            initiatedRef.current = true;

            // Load TossPayments SDK
            if (!window.TossPayments) {
                const script = document.createElement("script");
                script.src = "https://js.tosspayments.com/v1";
                script.async = true;
                await new Promise<void>((resolve, reject) => {
                    script.onload = () => resolve();
                    script.onerror = () =>
                        reject(new Error("Failed to load TossPayments SDK"));
                    document.body.appendChild(script);
                });
            }

            // 카드 업데이트는 빌링용 클라이언트 키 사용
            const clientKey = process.env.NEXT_PUBLIC_TOSS_BILLING_CLIENT_KEY;
            if (!clientKey) {
                setError("TossPayments billing client key not configured");
                return;
            }

            const tossPayments = window.TossPayments!(clientKey);
            const customerKey = `update_${authUser.uid}_${Date.now()}`;

            try {
                await tossPayments.requestBillingAuth("카드", {
                    customerKey,
                    successUrl: `${window.location.origin}/update-card/callback?customerKey=${customerKey}`,
                    failUrl: `${window.location.origin}/update-card?error=failed`,
                });
            } catch (err) {
                console.error("TossPayments billing auth error:", err);
                setError("카드 등록을 시작할 수 없습니다.");
            }
        };

        initTossPayments();
    }, [loading, authUser]);

    // Handle error from URL
    useEffect(() => {
        const errorParam = searchParams.get("error");
        if (errorParam) {
            setError("카드 등록에 실패했습니다. 다시 시도해주세요.");
        }
    }, [searchParams]);

    if (loading) {
        return (
            <div
                style={{
                    display: "flex",
                    justifyContent: "center",
                    alignItems: "center",
                    height: "100vh",
                    background: "#f9fafb",
                }}
            >
                <div style={{ textAlign: "center" }}>
                    <div
                        className="loading-spinner"
                        style={{
                            width: "40px",
                            height: "40px",
                            border: "3px solid #e5e7eb",
                            borderTopColor: "#2563eb",
                            borderRadius: "50%",
                            animation: "spin 1s linear infinite",
                            margin: "0 auto 1rem",
                        }}
                    />
                    <p style={{ color: "#6b7280" }}>로딩 중...</p>
                </div>
            </div>
        );
    }

    if (!authUser) {
        return (
            <div
                style={{
                    display: "flex",
                    justifyContent: "center",
                    alignItems: "center",
                    height: "100vh",
                    background: "#f9fafb",
                }}
            >
                <div
                    style={{
                        background: "white",
                        padding: "2rem",
                        borderRadius: "12px",
                        boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1)",
                        textAlign: "center",
                    }}
                >
                    <h2 style={{ marginBottom: "1rem" }}>
                        로그인이 필요합니다
                    </h2>
                    <button
                        onClick={() => router.push("/login")}
                        style={{
                            background: "#2563eb",
                            color: "white",
                            padding: "0.75rem 1.5rem",
                            borderRadius: "8px",
                            border: "none",
                            cursor: "pointer",
                        }}
                    >
                        로그인하기
                    </button>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div
                style={{
                    display: "flex",
                    justifyContent: "center",
                    alignItems: "center",
                    height: "100vh",
                    background: "#f9fafb",
                }}
            >
                <div
                    style={{
                        background: "white",
                        padding: "2rem",
                        borderRadius: "12px",
                        boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1)",
                        textAlign: "center",
                        maxWidth: "400px",
                    }}
                >
                    <div
                        style={{
                            width: "48px",
                            height: "48px",
                            background: "#fef2f2",
                            borderRadius: "50%",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            margin: "0 auto 1rem",
                        }}
                    >
                        <svg
                            width="24"
                            height="24"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="#ef4444"
                            strokeWidth="2"
                        >
                            <circle cx="12" cy="12" r="10" />
                            <line x1="15" y1="9" x2="9" y2="15" />
                            <line x1="9" y1="9" x2="15" y2="15" />
                        </svg>
                    </div>
                    <h2 style={{ marginBottom: "0.5rem", color: "#111827" }}>
                        오류 발생
                    </h2>
                    <p style={{ color: "#6b7280", marginBottom: "1.5rem" }}>
                        {error}
                    </p>
                    <div
                        style={{
                            display: "flex",
                            gap: "0.5rem",
                            justifyContent: "center",
                        }}
                    >
                        <button
                            onClick={() =>
                                router.push("/profile?tab=subscription")
                            }
                            style={{
                                background: "#f3f4f6",
                                color: "#374151",
                                padding: "0.75rem 1.5rem",
                                borderRadius: "8px",
                                border: "none",
                                cursor: "pointer",
                            }}
                        >
                            프로필로 돌아가기
                        </button>
                        <button
                            onClick={() => {
                                setError(null);
                                initiatedRef.current = false;
                                window.location.href = "/update-card";
                            }}
                            style={{
                                background: "#2563eb",
                                color: "white",
                                padding: "0.75rem 1.5rem",
                                borderRadius: "8px",
                                border: "none",
                                cursor: "pointer",
                            }}
                        >
                            다시 시도
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div
            style={{
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                height: "100vh",
                background: "#f9fafb",
            }}
        >
            <div style={{ textAlign: "center" }}>
                <div
                    className="loading-spinner"
                    style={{
                        width: "40px",
                        height: "40px",
                        border: "3px solid #e5e7eb",
                        borderTopColor: "#2563eb",
                        borderRadius: "50%",
                        animation: "spin 1s linear infinite",
                        margin: "0 auto 1rem",
                    }}
                />
                <p style={{ color: "#6b7280" }}>
                    결제 수단 등록 페이지로 이동 중...
                </p>
            </div>
            <style jsx>{`
                @keyframes spin {
                    to {
                        transform: rotate(360deg);
                    }
                }
            `}</style>
        </div>
    );
}
