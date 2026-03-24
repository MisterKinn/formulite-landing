"use client";

import React, { Suspense } from "react";
import { useSearchParams } from "next/navigation";

function CardRegistrationFailContent() {
    const searchParams = useSearchParams();
    const code = searchParams.get("code");
    const message = searchParams.get("message");

    return (
        <div style={s.fullscreen}>
            <div style={s.card}>
                <div style={s.failIcon}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                        <path d="M18 6L6 18M6 6l12 12" stroke="#e04956" strokeWidth="2.5" strokeLinecap="round" />
                    </svg>
                </div>

                <h1 style={s.title}>카드 등록 실패</h1>
                <p style={s.desc}>카드 등록 중 오류가 발생했습니다.</p>

                {(code || message) && (
                    <div style={s.detailBox}>
                        <div style={s.sectionLabel}>오류 상세</div>
                        {code && (
                            <div style={s.detailRow}>
                                <span style={s.detailLabel}>오류 코드</span>
                                <span style={s.detailCode}>{code}</span>
                            </div>
                        )}
                        {message && (
                            <div style={{ ...s.detailRow, borderBottom: "none", paddingBottom: 0 }}>
                                <span style={s.detailLabel}>오류 메시지</span>
                                <span style={s.detailValue}>{message}</span>
                            </div>
                        )}
                    </div>
                )}

                <div style={s.helpBox}>
                    <div style={s.sectionLabel}>해결 방법</div>
                    <div style={s.helpItem}>
                        <span style={s.helpDot} />
                        <span style={s.helpText}>카드 정보를 다시 확인해주세요</span>
                    </div>
                    <div style={s.helpItem}>
                        <span style={s.helpDot} />
                        <span style={s.helpText}>네트워크 연결을 확인해주세요</span>
                    </div>
                    <div style={s.helpItem}>
                        <span style={s.helpDot} />
                        <span style={s.helpText}>잠시 후 다시 시도해주세요</span>
                    </div>
                    <div style={s.helpItem}>
                        <span style={s.helpDot} />
                        <span style={s.helpText}>문제가 지속되면 고객센터에 문의해주세요</span>
                    </div>
                </div>

                <div style={s.btnStack}>
                    <button style={s.primaryBtn} onClick={() => (window.location.href = "/card-registration")}>
                        다시 시도
                    </button>
                    <div style={s.btnRow}>
                        <button style={s.secondaryBtn} onClick={() => (window.location.href = "/profile")}>
                            프로필로 이동
                        </button>
                        <button style={s.secondaryBtn} onClick={() => (window.location.href = "/")}>
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
                <div style={s.fullscreen}>
                    <div style={s.card}>
                        <div style={{ width: 48, height: 48, borderRadius: "50%", background: "#333", margin: "0 auto 16px" }} />
                        <p style={{ color: "#888", fontSize: 13 }}>로딩 중...</p>
                    </div>
                </div>
            }
        >
            <CardRegistrationFailContent />
        </Suspense>
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
        lineHeight: 1.5,
    },
    detailBox: {
        background: "#1a1a1a",
        borderRadius: 6,
        border: "1px solid #2e2e2e",
        padding: 16,
        marginBottom: 12,
        textAlign: "left",
    },
    sectionLabel: {
        fontSize: 12,
        fontWeight: 500,
        color: "#666",
        letterSpacing: "0.04em",
        marginBottom: 12,
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
    helpBox: {
        background: "#1a1a1a",
        borderRadius: 6,
        border: "1px solid #2e2e2e",
        padding: 16,
        marginBottom: 20,
        textAlign: "left",
    },
    helpItem: {
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        marginBottom: 6,
    },
    helpDot: {
        width: 6,
        height: 6,
        borderRadius: "50%",
        background: "#3b82f6",
        flexShrink: 0,
        marginTop: 5,
    },
    helpText: {
        fontSize: 13,
        color: "#aaa",
        lineHeight: 1.5,
    },
    btnStack: {
        display: "flex",
        flexDirection: "column",
        gap: 8,
    },
    btnRow: {
        display: "flex",
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
        flex: 1,
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
