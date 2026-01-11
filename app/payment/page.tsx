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
    const [errorCode, setErrorCode] = useState<number | null>(null);
    const [debugInfo, setDebugInfo] = useState<any>(null);
    const [checkingStatus, setCheckingStatus] = useState(false);

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

    // Helper: check script status via server-side endpoint (avoids CORS issues)
    const checkScriptStatus = async () => {
        setCheckingStatus(true);
        try {
            const res = await fetch("/api/toss-script");
            const json = await res.json();
            setDebugInfo(json);
            setErrorCode(json.status || null);
            console.debug("[TOSS DEBUG] script status:", json);
            return json;
        } catch (err) {
            setDebugInfo({ error: String(err) });
            console.error("[TOSS DEBUG] status check failed", err);
            return { ok: false, error: String(err) };
        } finally {
            setCheckingStatus(false);
        }
    };

    // Helper: load script programmatically and return promise
    const loadWidgetScript = (): Promise<void> => {
        return new Promise((resolve, reject) => {
            try {
                const existing = document.getElementById("toss-sdk-script");
                if (existing) {
                    existing.remove();
                }
                const script = document.createElement("script");
                script.id = "toss-sdk-script";
                script.src = "https://js.tosspayments.com/v2/payment-widget";
                script.async = true;
                script.onload = () => resolve();
                script.onerror = () => reject(new Error("script load error"));
                document.head.appendChild(script);
            } catch (err) {
                reject(err);
            }
        });
    };

    const retryLoad = async () => {
        setError("");
        setErrorCode(null);
        setDebugInfo(null);
        setLoading(true);
        try {
            await loadWidgetScript();
            if (window.TossPayments && typeof window.TossPayments === "function") {
                if (IS_RECURRING) {
                    handleRecurringPayment();
                } else {
                    handleAutoPayment();
                }
            } else {
                setError("결제 SDK가 로드되었으나 초기화되지 않았습니다.");
                await checkScriptStatus();
                setLoading(false);
            }
        } catch (err) {
            setError("결제 SDK 로드 실패. 네트워크 또는 브라우저 문제일 수 있습니다.");
            await checkScriptStatus();
            setLoading(false);
        }
    };

    useEffect(() => {
        const tryLoad = async () => {
            try {
                await loadWidgetScript();
                if (window.TossPayments && typeof window.TossPayments === "function") {
                    if (IS_RECURRING) {
                        handleRecurringPayment();
                    } else {
                        handleAutoPayment();
                    }
                } else {
                    setError("결제 SDK가 로드되었으나 window.TossPayments가 없습니다. SDK 버전 또는 네트워크 문제일 수 있습니다.");
                    await checkScriptStatus();
                    setLoading(false);
                }
            } catch (err) {
                setError("결제 SDK 로드 실패. 네트워크 또는 브라우저 문제일 수 있습니다.");
                await checkScriptStatus();
                setLoading(false);
            }
        };

        // Start
        tryLoad();
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
                                marginBottom: 12,
                                opacity: 0.9,
                            }}
                        >
                            {error}
                        </p>

                        {/* Diagnostics */}
                        {errorCode ? (
                            <p style={{ fontSize: 13, color: "#bbb", marginBottom: 12 }}>
                                상태 코드: <strong style={{ color: "#fff" }}>{errorCode}</strong>
                            </p>
                        ) : null}
                        {checkingStatus ? (
                            <p style={{ fontSize: 13, color: "#bbb", marginBottom: 12 }}>상태 확인 중...</p>
                        ) : null}

                        <div style={{ display: "flex", gap: 8, justifyContent: "center", marginBottom: 8 }}>
                            <button
                                onClick={retryLoad}
                                style={{
                                    padding: "10px 20px",
                                    background: "#fff",
                                    color: "#667eea",
                                    border: "none",
                                    borderRadius: 8,
                                    fontWeight: 600,
                                    fontSize: 14,
                                    cursor: "pointer",
                                }}
                            >
                                재시도
                            </button>
                            <button
                                onClick={checkScriptStatus}
                                style={{
                                    padding: "10px 20px",
                                    background: "#222",
                                    color: "#fff",
                                    border: "2px solid #444",
                                    borderRadius: 8,
                                    fontWeight: 600,
                                    fontSize: 14,
                                    cursor: "pointer",
                                }}
                            >
                                상태 확인
                            </button>
                            <button
                                onClick={async () => {
                                    try {
                                        const host = window.location.href;
                                        const body = {
                                            time: new Date().toISOString(),
                                            url: host,
                                            error,
                                            status: errorCode,
                                            debug: debugInfo,
                                        };
                                        const text = `도메인: ${host}\n문제: TossPayments payment-widget 스크립트 요청이 403 또는 차단되었습니다.\n상세:\n${JSON.stringify(body, null, 2)}`;
                                        await navigator.clipboard.writeText(text);
                                        alert("지원 메시지가 클립보드에 복사되었습니다. TossPayments에 붙여넣어 보내세요.");
                                    } catch (err) {
                                        alert("복사에 실패했습니다.");
                                    }
                                }}
                                style={{
                                    padding: "10px 20px",
                                    background: "#0164ff",
                                    color: "#fff",
                                    border: "none",
                                    borderRadius: 8,
                                    fontWeight: 600,
                                    fontSize: 14,
                                    cursor: "pointer",
                                }}
                            >
                                지원 내용 복사
                            </button>
                        </div>

                        {debugInfo ? (
                            <pre style={{ textAlign: "left", maxWidth: 520, margin: "8px auto 0", fontSize: 12, color: "#ccc", background: "#0a0a0a", padding: 10, borderRadius: 6, overflowX: "auto" }}>
                                {JSON.stringify(debugInfo, null, 2)}
                            </pre>
                        ) : null}
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
