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
                <div style={styles.iconWrap}>
                    <svg
                        width="56"
                        height="56"
                        viewBox="0 0 56 56"
                        fill="none"
                    >
                        <circle cx="28" cy="28" r="28" fill="#FF4755" fillOpacity="0.12" />
                        <circle cx="28" cy="28" r="20" fill="#FF4755" fillOpacity="0.2" />
                        <path
                            d="M22 22L34 34M34 22L22 34"
                            stroke="#FF4755"
                            strokeWidth="3"
                            strokeLinecap="round"
                        />
                    </svg>
                </div>

                <h1 style={styles.title}>카드 등록 실패</h1>
                <p style={styles.description}>
                    카드 등록 중 오류가 발생했습니다.
                </p>

                {(code || message) && (
                    <div style={styles.detailBox}>
                        <div style={styles.detailHeader}>
                            <span style={styles.detailHeaderDot} />
                            <span style={styles.detailHeaderText}>오류 상세</span>
                        </div>
                        <div style={styles.detailBody}>
                            {code && (
                                <div style={styles.detailRow}>
                                    <span style={styles.detailLabel}>오류 코드</span>
                                    <span style={styles.detailValue}>{code}</span>
                                </div>
                            )}
                            {message && (
                                <div style={{ ...styles.detailRow, border: "none", paddingBottom: 0 }}>
                                    <span style={styles.detailLabel}>오류 메시지</span>
                                    <span style={styles.detailMessage}>{message}</span>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                <div style={styles.helpBox}>
                    <div style={styles.helpHeader}>
                        <span style={styles.helpHeaderDot} />
                        <span style={styles.detailHeaderText}>해결 방법</span>
                    </div>
                    <ul style={styles.helpList}>
                        <li style={styles.helpItem}>카드 정보를 다시 확인해주세요</li>
                        <li style={styles.helpItem}>네트워크 연결을 확인해주세요</li>
                        <li style={styles.helpItem}>잠시 후 다시 시도해주세요</li>
                        <li style={styles.helpItem}>문제가 지속되면 고객센터에 문의해주세요</li>
                    </ul>
                </div>

                <div style={styles.buttonGroup}>
                    <button
                        style={styles.primaryBtn}
                        onClick={() =>
                            (window.location.href = "/card-registration")
                        }
                        onMouseEnter={(e) => {
                            e.currentTarget.style.opacity = "0.85";
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.opacity = "1";
                        }}
                    >
                        다시 시도
                    </button>
                    <div style={styles.secondaryRow}>
                        <button
                            style={styles.secondaryBtn}
                            onClick={() => (window.location.href = "/profile")}
                            onMouseEnter={(e) => {
                                e.currentTarget.style.backgroundColor = "#2a2a2a";
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.backgroundColor = "#1e1e1e";
                            }}
                        >
                            프로필로 이동
                        </button>
                        <button
                            style={styles.secondaryBtn}
                            onClick={() => (window.location.href = "/")}
                            onMouseEnter={(e) => {
                                e.currentTarget.style.backgroundColor = "#2a2a2a";
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.backgroundColor = "#1e1e1e";
                            }}
                        >
                            홈으로 이동
                        </button>
                    </div>
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
                        <div style={styles.iconWrap}>
                            <div style={{ width: 56, height: 56, borderRadius: "50%", backgroundColor: "#1e1e1e" }} />
                        </div>
                        <p style={{ color: "#666", fontSize: 15 }}>로딩 중...</p>
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
        backgroundColor: "#0e0e0e",
        padding: "20px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    } as React.CSSProperties,
    card: {
        backgroundColor: "#171717",
        borderRadius: "24px",
        border: "1px solid #222",
        padding: "40px 32px 32px",
        maxWidth: "440px",
        width: "100%",
        textAlign: "center",
    } as React.CSSProperties,
    iconWrap: {
        marginBottom: "24px",
        display: "flex",
        justifyContent: "center",
    } as React.CSSProperties,
    title: {
        fontSize: "22px",
        fontWeight: "700",
        marginBottom: "8px",
        color: "#ffffff",
        letterSpacing: "-0.3px",
    } as React.CSSProperties,
    description: {
        fontSize: "15px",
        color: "#888",
        marginBottom: "28px",
        lineHeight: "1.5",
    } as React.CSSProperties,
    detailBox: {
        backgroundColor: "#1e1e1e",
        borderRadius: "16px",
        overflow: "hidden",
        marginBottom: "16px",
        textAlign: "left",
    } as React.CSSProperties,
    detailHeader: {
        display: "flex",
        alignItems: "center",
        gap: "8px",
        padding: "16px 20px 12px",
    } as React.CSSProperties,
    detailHeaderDot: {
        width: "6px",
        height: "6px",
        borderRadius: "50%",
        backgroundColor: "#FF4755",
        flexShrink: 0,
    } as React.CSSProperties,
    detailHeaderText: {
        fontSize: "14px",
        fontWeight: "600",
        color: "#bbb",
        letterSpacing: "-0.2px",
    } as React.CSSProperties,
    detailBody: {
        padding: "0 20px 16px",
    } as React.CSSProperties,
    detailRow: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "10px 0",
        borderBottom: "1px solid #2a2a2a",
    } as React.CSSProperties,
    detailLabel: {
        fontSize: "14px",
        color: "#666",
        flexShrink: 0,
    } as React.CSSProperties,
    detailValue: {
        fontFamily: "'SF Mono', 'Fira Code', monospace",
        fontSize: "13px",
        backgroundColor: "#2a2a2a",
        color: "#FF4755",
        padding: "4px 10px",
        borderRadius: "8px",
    } as React.CSSProperties,
    detailMessage: {
        fontSize: "14px",
        color: "#ccc",
        textAlign: "right",
        maxWidth: "60%",
    } as React.CSSProperties,
    helpBox: {
        backgroundColor: "#1e1e1e",
        borderRadius: "16px",
        overflow: "hidden",
        marginBottom: "28px",
        textAlign: "left",
    } as React.CSSProperties,
    helpHeader: {
        display: "flex",
        alignItems: "center",
        gap: "8px",
        padding: "16px 20px 8px",
    } as React.CSSProperties,
    helpHeaderDot: {
        width: "6px",
        height: "6px",
        borderRadius: "50%",
        backgroundColor: "#3182f6",
        flexShrink: 0,
    } as React.CSSProperties,
    helpList: {
        margin: "0",
        padding: "0 20px 16px 20px",
        listStyle: "none",
    } as React.CSSProperties,
    helpItem: {
        fontSize: "14px",
        color: "#999",
        lineHeight: "1.6",
        padding: "4px 0",
        paddingLeft: "14px",
        position: "relative",
    } as React.CSSProperties,
    buttonGroup: {
        display: "flex",
        flexDirection: "column",
        gap: "10px",
    } as React.CSSProperties,
    primaryBtn: {
        width: "100%",
        padding: "16px",
        fontSize: "16px",
        fontWeight: "600",
        border: "none",
        borderRadius: "14px",
        backgroundColor: "#3182f6",
        color: "#ffffff",
        cursor: "pointer",
        transition: "opacity 0.15s ease",
        letterSpacing: "-0.2px",
    } as React.CSSProperties,
    secondaryRow: {
        display: "flex",
        gap: "10px",
    } as React.CSSProperties,
    secondaryBtn: {
        flex: 1,
        padding: "14px",
        fontSize: "14px",
        fontWeight: "500",
        border: "1px solid #2a2a2a",
        borderRadius: "14px",
        backgroundColor: "#1e1e1e",
        color: "#aaa",
        cursor: "pointer",
        transition: "background-color 0.15s ease",
    } as React.CSSProperties,
};
