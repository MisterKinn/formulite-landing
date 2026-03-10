"use client";

import React, { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { Navbar } from "../../../components/Navbar";
const Sidebar = dynamic(() => import("../../../components/Sidebar"), {
    ssr: false,
});
import "../../style.css";
import "../../mobile.css";

export default function PaymentFailPage() {
    return (
        <React.Suspense fallback={<div>Loading...</div>}>
            <PaymentFailContent />
        </React.Suspense>
    );
}

function PaymentFailContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [errorMessage, setErrorMessage] = useState(
        "결제 처리 중 오류가 발생했습니다."
    );
    const [errorCode, setErrorCode] = useState("UNKNOWN_ERROR");

    useEffect(() => {
        const code = searchParams?.get("code");
        const message = searchParams?.get("message");

        setErrorCode(code || "UNKNOWN_ERROR");
        setErrorMessage(message || "결제 처리 중 오류가 발생했습니다.");
    }, [searchParams]);

    return (
        <>
            <Navbar />
            <Sidebar />

            <div
                style={{
                    maxWidth: 480,
                    margin: "48px auto",
                    padding: 32,
                    background: "#fff",
                    borderRadius: 16,
                    boxShadow: "0 2px 16px #0002",
                }}
            >
                <h2
                    style={{
                        color: "#d32f2f",
                        marginBottom: 8,
                        textAlign: "center",
                    }}
                >
                    ❌ 결제 실패
                </h2>

                <div
                    style={{
                        background: "#ffebee",
                        padding: 16,
                        borderRadius: 8,
                        marginBottom: 24,
                        borderLeft: "4px solid #d32f2f",
                    }}
                >
                    <div style={{ marginBottom: 12 }}>
                        <span
                            style={{
                                color: "#999",
                                display: "block",
                                fontSize: 12,
                            }}
                        >
                            에러 코드
                        </span>
                        <span style={{ fontWeight: 600, color: "#d32f2f" }}>
                            {errorCode}
                        </span>
                    </div>

                    <div>
                        <span
                            style={{
                                color: "#999",
                                display: "block",
                                fontSize: 12,
                            }}
                        >
                            오류 메시지
                        </span>
                        <span style={{ fontWeight: 500 }}>{errorMessage}</span>
                    </div>
                </div>

                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 12,
                    }}
                >
                    <button
                        onClick={() => router.push("/")}
                        style={{
                            width: "100%",
                            padding: 16,
                            background: "#0064FF",
                            color: "#fff",
                            border: "none",
                            borderRadius: 8,
                            fontWeight: 600,
                            fontSize: 16,
                            cursor: "pointer",
                        }}
                    >
                        다시 결제하기
                    </button>

                    <button
                        onClick={() => router.push("/")}
                        style={{
                            width: "100%",
                            padding: 16,
                            background: "#f5f5f5",
                            color: "#333",
                            border: "none",
                            borderRadius: 8,
                            fontWeight: 600,
                            fontSize: 16,
                            cursor: "pointer",
                        }}
                    >
                        홈으로 돌아가기
                    </button>
                </div>
            </div>
        </>
    );
}
