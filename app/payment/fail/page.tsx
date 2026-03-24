"use client";

import React, { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Navbar } from "../../../components/Navbar";
import "../../style.css";
import "../../mobile.css";

export default function PaymentFailPage() {
    return (
        <>
            <Navbar />
            <React.Suspense fallback={<div style={{ minHeight: "100vh", background: "#171717" }} />}>
                <PaymentFailContent />
            </React.Suspense>
        </>
    );
}

function PaymentFailContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [errorMessage, setErrorMessage] = useState("결제 처리 중 오류가 발생했습니다.");
    const [errorCode, setErrorCode] = useState("UNKNOWN_ERROR");

    useEffect(() => {
        const code = searchParams?.get("code");
        const message = searchParams?.get("message");
        setErrorCode(code || "UNKNOWN_ERROR");
        setErrorMessage(message || "결제 처리 중 오류가 발생했습니다.");
    }, [searchParams]);

    return (
        <div style={s.fullscreen}>
            <div style={s.card}>
                <div style={s.failIcon}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                        <path d="M18 6L6 18M6 6l12 12" stroke="#e04956" strokeWidth="2.5" strokeLinecap="round" />
                    </svg>
                </div>

                <h1 style={s.title}>결제 실패</h1>
                <p style={s.desc}>결제 처리 중 문제가 발생했습니다.</p>

                <div style={s.detailBox}>
                    <div style={s.detailRow}>
                        <span style={s.detailLabel}>에러 코드</span>
                        <span style={s.detailCode}>{errorCode}</span>
                    </div>
                    <div style={{ ...s.detailRow, borderBottom: "none", paddingBottom: 0 }}>
                        <span style={s.detailLabel}>오류 메시지</span>
                        <span style={s.detailValue}>{errorMessage}</span>
                    </div>
                </div>

                <div style={s.btnGroup}>
                    <button style={s.primaryBtn} onClick={() => router.push("/")}>
                        다시 결제하기
                    </button>
                    <button style={s.secondaryBtn} onClick={() => router.push("/")}>
                        홈으로 돌아가기
                    </button>
                </div>
            </div>
        </div>
    );
}

const s: Record<string, React.CSSProperties> = {
    fullscreen: {
        minHeight: "100vh",
        background: "#171717",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
    },
    card: {
        width: "100%",
        maxWidth: 420,
        background: "#222",
        borderRadius: 8,
        border: "1px solid #2e2e2e",
        padding: "32px 28px",
        textAlign: "center",
    },
    failIcon: {
        width: 48,
        height: 48,
        borderRadius: "50%",
        background: "rgba(224,73,86,0.1)",
        border: "1px solid rgba(224,73,86,0.2)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        margin: "0 auto 20px",
    },
    title: {
        fontSize: 18,
        fontWeight: 500,
        marginBottom: 8,
        color: "#ededed",
    },
    desc: {
        fontSize: 13,
        color: "#888",
        marginBottom: 20,
    },
    detailBox: {
        background: "#1a1a1a",
        borderRadius: 6,
        border: "1px solid #2e2e2e",
        padding: "16px",
        marginBottom: 20,
        textAlign: "left",
    },
    detailRow: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "8px 0",
        borderBottom: "1px solid #2e2e2e",
    },
    detailLabel: {
        fontSize: 13,
        color: "#666",
    },
    detailCode: {
        fontFamily: "'SF Mono', 'Fira Code', monospace",
        fontSize: 12,
        background: "rgba(224,73,86,0.1)",
        color: "#e04956",
        padding: "3px 8px",
        borderRadius: 4,
    },
    detailValue: {
        fontSize: 13,
        color: "#ededed",
        textAlign: "right",
        maxWidth: "60%",
    },
    btnGroup: {
        display: "flex",
        flexDirection: "column",
        gap: 8,
    },
    primaryBtn: {
        width: "100%",
        height: 38,
        background: "#ededed",
        color: "#171717",
        border: "none",
        borderRadius: 6,
        fontSize: 13,
        fontWeight: 500,
        cursor: "pointer",
    },
    secondaryBtn: {
        width: "100%",
        height: 38,
        background: "transparent",
        color: "#888",
        border: "1px solid #333",
        borderRadius: 6,
        fontSize: 13,
        fontWeight: 500,
        cursor: "pointer",
    },
};
