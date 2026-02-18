"use client";

import { Suspense, useEffect, useState } from "react";
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

export default function UpdateCardCallbackPage() {
    return (
        <Suspense fallback={<LoadingSpinner />}>
            <UpdateCardCallbackContent />
        </Suspense>
    );
}

function UpdateCardCallbackContent() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const [status, setStatus] = useState<"processing" | "success" | "error">(
        "processing",
    );
    const [error, setError] = useState<string | null>(null);
    const [authUser, setAuthUser] = useState<User | null>(null);
    const [authLoading, setAuthLoading] = useState(true);

    useEffect(() => {
        const firebaseApp = getFirebaseAppOrNull();
        if (!firebaseApp) {
            setAuthUser(null);
            setAuthLoading(false);
            return;
        }
        const auth = getAuth(firebaseApp);
        const unsubscribe = onAuthStateChanged(auth, (user) => {
            setAuthUser(user);
            setAuthLoading(false);
        });
        return () => unsubscribe();
    }, []);

    useEffect(() => {
        if (authLoading || !authUser) return;

        const processCardUpdate = async () => {
            const authKey = searchParams.get("authKey");
            const customerKey = searchParams.get("customerKey");

            if (!authKey || !customerKey) {
                setError("필수 파라미터가 누락되었습니다.");
                setStatus("error");
                return;
            }

            try {
                // Issue billing key from auth key
                const issueResponse = await fetch("/api/billing/issue", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ authKey, customerKey }),
                });

                const issueData = await issueResponse.json();

                if (!issueResponse.ok || !issueData.billingKey) {
                    throw new Error(issueData.error || "빌링키 발급 실패");
                }

                // Update card with new billing key
                const token = await authUser.getIdToken();
                const updateResponse = await fetch("/api/billing/update-card", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify({
                        billingKey: issueData.billingKey,
                        customerKey: customerKey,
                    }),
                });

                const updateData = await updateResponse.json();

                if (!updateResponse.ok) {
                    throw new Error(updateData.error || "카드 업데이트 실패");
                }

                setStatus("success");

                // Redirect to profile after 2 seconds
                setTimeout(() => {
                    router.push("/profile?tab=subscription&cardUpdated=true");
                }, 2000);
            } catch (err) {
                console.error("Card update error:", err);
                setError(
                    err instanceof Error
                        ? err.message
                        : "카드 업데이트 중 오류가 발생했습니다.",
                );
                setStatus("error");
            }
        };

        processCardUpdate();
    }, [authLoading, authUser, searchParams, router]);

    if (authLoading) {
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
                    <p style={{ color: "#6b7280" }}>인증 확인 중...</p>
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
                    <h2>로그인이 필요합니다</h2>
                    <button
                        onClick={() => router.push("/login")}
                        style={{
                            background: "#2563eb",
                            color: "white",
                            padding: "0.75rem 1.5rem",
                            borderRadius: "8px",
                            border: "none",
                            cursor: "pointer",
                            marginTop: "1rem",
                        }}
                    >
                        로그인하기
                    </button>
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
                {status === "processing" && (
                    <>
                        <div
                            style={{
                                width: "48px",
                                height: "48px",
                                border: "3px solid #e5e7eb",
                                borderTopColor: "#2563eb",
                                borderRadius: "50%",
                                animation: "spin 1s linear infinite",
                                margin: "0 auto 1rem",
                            }}
                        />
                        <h2
                            style={{ marginBottom: "0.5rem", color: "#111827" }}
                        >
                            카드 정보 업데이트 중...
                        </h2>
                        <p style={{ color: "#6b7280" }}>잠시만 기다려주세요.</p>
                    </>
                )}

                {status === "success" && (
                    <>
                        <div
                            style={{
                                width: "48px",
                                height: "48px",
                                background: "#f0fdf4",
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
                                stroke="#22c55e"
                                strokeWidth="2"
                            >
                                <polyline points="20,6 9,17 4,12" />
                            </svg>
                        </div>
                        <h2
                            style={{ marginBottom: "0.5rem", color: "#111827" }}
                        >
                            카드가 변경되었습니다!
                        </h2>
                        <p style={{ color: "#6b7280" }}>
                            프로필 페이지로 이동합니다...
                        </p>
                    </>
                )}

                {status === "error" && (
                    <>
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
                        <h2
                            style={{ marginBottom: "0.5rem", color: "#111827" }}
                        >
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
                                onClick={() => router.push("/update-card")}
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
                    </>
                )}
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
