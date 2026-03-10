"use client";

import React, { Suspense } from "react";
import { useSearchParams } from "next/navigation";

function CardRegistrationFailContent() {
    const searchParams = useSearchParams();
    const code = searchParams.get("code");
    const message = searchParams.get("message");

    return (
        <div style={styles.container}>
            <div style={styles.card}>
                <div style={styles.errorIcon}>❌</div>
                <h1 style={styles.title}>카드 등록 실패</h1>
                <p style={styles.description}>
                    카드 등록 중 오류가 발생했습니다.
                </p>

                {(code || message) && (
                    <div style={styles.errorDetails}>
                        <h3 style={styles.errorTitle}>📋 오류 상세</h3>
                        {code && (
                            <div style={styles.errorRow}>
                                <span>오류 코드:</span>
                                <span style={styles.errorCode}>{code}</span>
                            </div>
                        )}
                        {message && (
                            <div style={styles.errorRow}>
                                <span>오류 메시지:</span>
                                <span>{message}</span>
                            </div>
                        )}
                    </div>
                )}

                <div style={styles.troubleshooting}>
                    <h3 style={styles.troubleTitle}>🔧 해결 방법</h3>
                    <ul style={styles.troubleList}>
                        <li>카드 정보를 다시 확인해주세요</li>
                        <li>네트워크 연결을 확인해주세요</li>
                        <li>잠시 후 다시 시도해주세요</li>
                        <li>문제가 지속되면 고객센터에 문의해주세요</li>
                    </ul>
                </div>

                <div style={styles.buttonGroup}>
                    <button
                        style={styles.button}
                        onClick={() =>
                            (window.location.href = "/card-registration")
                        }
                    >
                        다시 시도
                    </button>
                    <button
                        style={styles.secondaryButton}
                        onClick={() => (window.location.href = "/profile")}
                    >
                        프로필로 이동
                    </button>
                    <button
                        style={styles.secondaryButton}
                        onClick={() => (window.location.href = "/")}
                    >
                        홈으로 이동
                    </button>
                </div>
            </div>
        </div>
    );
}

export default function CardRegistrationFailPage() {
    return (
        <Suspense
            fallback={
                <div style={styles.container}>
                    <div style={styles.card}>
                        <div style={styles.errorIcon}>⏳</div>
                        <p>로딩 중...</p>
                    </div>
                </div>
            }
        >
            <CardRegistrationFailContent />
        </Suspense>
    );
}

const styles = {
    container: {
        minHeight: "100vh",
        backgroundColor: "#f8fafc",
        padding: "20px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
    } as React.CSSProperties,
    card: {
        backgroundColor: "#ffffff",
        borderRadius: "16px",
        padding: "32px",
        boxShadow: "0 4px 20px rgba(0,0,0,0.1)",
        maxWidth: "600px",
        width: "100%",
        textAlign: "center",
    } as React.CSSProperties,
    errorIcon: {
        fontSize: "48px",
        marginBottom: "16px",
    } as React.CSSProperties,
    title: {
        fontSize: "28px",
        fontWeight: "700",
        marginBottom: "16px",
        color: "#dc2626",
    } as React.CSSProperties,
    description: {
        fontSize: "16px",
        color: "#6b7280",
        marginBottom: "24px",
        lineHeight: "1.6",
    } as React.CSSProperties,
    errorDetails: {
        backgroundColor: "#fef2f2",
        border: "1px solid #fecaca",
        borderRadius: "12px",
        padding: "20px",
        marginBottom: "24px",
        textAlign: "left",
    } as React.CSSProperties,
    errorTitle: {
        fontSize: "18px",
        fontWeight: "600",
        marginBottom: "12px",
        color: "#dc2626",
    } as React.CSSProperties,
    errorRow: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "8px 0",
        borderBottom: "1px solid #fee2e2",
    } as React.CSSProperties,
    errorCode: {
        fontFamily: "monospace",
        backgroundColor: "#f9fafb",
        padding: "4px 8px",
        borderRadius: "4px",
        fontSize: "14px",
    } as React.CSSProperties,
    troubleshooting: {
        backgroundColor: "#fefce8",
        border: "1px solid #fde047",
        borderRadius: "12px",
        padding: "20px",
        marginBottom: "24px",
        textAlign: "left",
    } as React.CSSProperties,
    troubleTitle: {
        fontSize: "18px",
        fontWeight: "600",
        marginBottom: "12px",
        color: "#a16207",
    } as React.CSSProperties,
    troubleList: {
        margin: "0",
        paddingLeft: "20px",
    } as React.CSSProperties,
    buttonGroup: {
        display: "flex",
        gap: "12px",
        justifyContent: "center",
        flexWrap: "wrap",
    } as React.CSSProperties,
    button: {
        padding: "16px 24px",
        fontSize: "16px",
        fontWeight: "600",
        border: "none",
        borderRadius: "12px",
        backgroundColor: "#0164ff",
        color: "#ffffff",
        cursor: "pointer",
        minWidth: "140px",
    } as React.CSSProperties,
    secondaryButton: {
        padding: "16px 24px",
        fontSize: "16px",
        fontWeight: "600",
        border: "2px solid #d1d5db",
        borderRadius: "12px",
        backgroundColor: "#ffffff",
        color: "#374151",
        cursor: "pointer",
        minWidth: "140px",
    } as React.CSSProperties,
};
