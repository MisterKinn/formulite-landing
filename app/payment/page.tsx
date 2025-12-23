"use client";
import React, { useState } from "react";

export default function PaymentPage() {
    return (
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
                    textAlign: "center",
                    marginBottom: 28,
                    fontSize: 28,
                    fontWeight: 700,
                }}
            >
                결제하기 (Payment)
            </h2>
            <div
                style={{ marginBottom: 32, color: "#666", textAlign: "center" }}
            >
                아래 버튼을 눌러 결제를 진행하세요.
                <br />
                (Toss Payments 연동 예정)
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                <button
                    style={{
                        width: "100%",
                        padding: 16,
                        background: "#0064FF",
                        color: "#fff",
                        border: "none",
                        borderRadius: 8,
                        fontWeight: 600,
                        fontSize: 18,
                        cursor: "pointer",
                        marginBottom: 8,
                    }}
                    disabled
                >
                    Toss Payments로 결제 (준비중)
                </button>
                <div
                    style={{ color: "#aaa", fontSize: 14, textAlign: "center" }}
                >
                    실제 결제는 곧 지원됩니다.
                </div>
            </div>
        </div>
    );
}
