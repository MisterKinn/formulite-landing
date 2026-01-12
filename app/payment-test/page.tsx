"use client";

import React from "react";
import Link from "next/link";

export default function PaymentTestPage() {
    const testPayments = [
        {
            name: "플러스 플랜 - 일회성",
            url: "/payment?amount=9900&orderName=Nova AI 플러스 요금제&recurring=false",
            description: "9,900원 일회성 결제",
        },
        {
            name: "플러스 플랜 - 월간 구독",
            url: "/payment?amount=9900&orderName=Nova AI 플러스 요금제&recurring=true&billingCycle=monthly",
            description: "9,900원 월간 자동결제 구독",
        },
        {
            name: "프로 플랜 - 월간 구독",
            url: "/payment?amount=29900&orderName=Nova AI 프로 요금제&recurring=true&billingCycle=monthly",
            description: "29,900원 월간 자동결제 구독",
        },
        {
            name: "프로 플랜 - 연간 구독",
            url: "/payment?amount=299000&orderName=Nova AI 프로 요금제&recurring=true&billingCycle=yearly",
            description: "299,000원 연간 자동결제 구독",
        },
    ];

    return (
        <div style={styles.container}>
            <div style={styles.card}>
                <h1 style={styles.title}>💳 결제 테스트</h1>
                <p style={styles.subtitle}>다양한 결제 방식을 테스트해보세요</p>

                <div style={styles.testGrid}>
                    {testPayments.map((payment, index) => (
                        <Link
                            key={index}
                            href={payment.url}
                            style={styles.testCard}
                        >
                            <h3 style={styles.testTitle}>{payment.name}</h3>
                            <p style={styles.testDescription}>
                                {payment.description}
                            </p>
                            <div style={styles.testBadge}>
                                {payment.url.includes("recurring=true")
                                    ? "🔄 구독"
                                    : "💳 일회성"}
                            </div>
                        </Link>
                    ))}
                </div>

                <div style={styles.instructions}>
                    <h2 style={styles.instructionTitle}>🧪 테스트 방법</h2>
                    <ol style={styles.instructionList}>
                        <li>
                            <strong>로그인</strong>: Firebase 인증으로 로그인
                        </li>
                        <li>
                            <strong>결제 방식 선택</strong>: 위의 카드 중 하나
                            클릭
                        </li>
                        <li>
                            <strong>테스트 카드 사용</strong>:
                            <div style={styles.cardInfo}>
                                <p>
                                    카드번호: <code>4000-0000-0000-0002</code>
                                </p>
                                <p>
                                    만료일: <code>12/28</code>
                                </p>
                                <p>
                                    CVC: <code>123</code>
                                </p>
                                <p>
                                    비밀번호: <code>00</code>
                                </p>
                            </div>
                        </li>
                        <li>
                            <strong>결과 확인</strong>: 구독의 경우 빌링키 발급
                            확인
                        </li>
                    </ol>
                </div>

                <div style={styles.navigation}>
                    <Link href="/" style={styles.navButton}>
                        🏠 홈으로
                    </Link>
                    <Link href="/profile" style={styles.navButton}>
                        👤 프로필
                    </Link>
                    <Link href="/subscription" style={styles.navButton}>
                        🔔 구독 관리
                    </Link>
                </div>
            </div>
        </div>
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
        maxWidth: "800px",
        width: "100%",
    } as React.CSSProperties,
    title: {
        fontSize: "32px",
        fontWeight: "700",
        marginBottom: "8px",
        textAlign: "center",
        color: "#1f2937",
    } as React.CSSProperties,
    subtitle: {
        fontSize: "16px",
        color: "#6b7280",
        marginBottom: "32px",
        textAlign: "center",
    } as React.CSSProperties,
    testGrid: {
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
        gap: "16px",
        marginBottom: "32px",
    } as React.CSSProperties,
    testCard: {
        display: "block",
        textDecoration: "none",
        border: "2px solid #e5e7eb",
        borderRadius: "12px",
        padding: "20px",
        backgroundColor: "#ffffff",
        transition: "all 0.2s",
        cursor: "pointer",
    } as React.CSSProperties,
    testTitle: {
        fontSize: "18px",
        fontWeight: "600",
        marginBottom: "8px",
        color: "#1f2937",
    } as React.CSSProperties,
    testDescription: {
        fontSize: "14px",
        color: "#6b7280",
        marginBottom: "12px",
        lineHeight: "1.5",
    } as React.CSSProperties,
    testBadge: {
        display: "inline-block",
        padding: "4px 12px",
        fontSize: "12px",
        fontWeight: "600",
        borderRadius: "20px",
        backgroundColor: "#f3f4f6",
        color: "#374151",
    } as React.CSSProperties,
    instructions: {
        backgroundColor: "#fefce8",
        border: "1px solid #fde047",
        borderRadius: "12px",
        padding: "24px",
        marginBottom: "24px",
    } as React.CSSProperties,
    instructionTitle: {
        fontSize: "20px",
        fontWeight: "600",
        marginBottom: "16px",
        color: "#a16207",
    } as React.CSSProperties,
    instructionList: {
        margin: "0",
        paddingLeft: "20px",
        color: "#92400e",
    } as React.CSSProperties,
    cardInfo: {
        backgroundColor: "#f9fafb",
        border: "1px solid #d1d5db",
        borderRadius: "8px",
        padding: "12px",
        marginTop: "8px",
        fontFamily: "monospace",
        fontSize: "14px",
    } as React.CSSProperties,
    navigation: {
        display: "flex",
        gap: "12px",
        justifyContent: "center",
        flexWrap: "wrap",
    } as React.CSSProperties,
    navButton: {
        display: "inline-block",
        textDecoration: "none",
        padding: "12px 20px",
        fontSize: "16px",
        fontWeight: "600",
        border: "2px solid #d1d5db",
        borderRadius: "8px",
        backgroundColor: "#ffffff",
        color: "#374151",
        transition: "all 0.2s",
    } as React.CSSProperties,
};
