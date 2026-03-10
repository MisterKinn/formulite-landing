"use client";
import React, { useState } from "react";
import { useAuth } from "../context/AuthContext";

const NAV_LINKS = [
    { label: "메인", href: "../#home" },
    { label: "강점", href: "../#benefits" },
    { label: "기능", href: "../#features" },
    { label: "후기", href: "../#testimonials" },
    { label: "요금제", href: "../#pricing" },
    { label: "자주 묻는 질문", href: "../#faq" },
];

export default function Sidebar() {
    const [isOpen, setIsOpen] = useState(false);
    const { isAuthenticated, avatar, user, logout } = useAuth();

    return (
        <>
            <button
                className={`sidebar-toggle mobile-menu-button`}
                onClick={() => setIsOpen(true)}
                aria-label="Open menu"
                aria-expanded={isOpen}
                style={{ display: isOpen ? "none" : undefined }}
            >
                <span className={`hamburger${isOpen ? " open" : ""}`}>
                    <span></span>
                    <span></span>
                    <span></span>
                </span>
            </button>
            {isOpen && (
                <div
                    className="sidebar-overlay"
                    onClick={() => setIsOpen(false)}
                />
            )}
            <aside className={`sidebar${isOpen ? " open" : ""}`}>
                <div className="sidebar-header">
                    <a href="../#home" className="sidebar-logo-a">
                        <div
                            className="sidebar-logo"
                            onClick={() => setIsOpen(false)}
                        >
                            Nova AI
                        </div>
                    </a>
                    <button
                        className="sidebar-close"
                        onClick={() => setIsOpen(false)}
                        aria-label="Close menu"
                    >
                        ×
                    </button>
                </div>
                <nav className="sidebar-nav">
                    {NAV_LINKS.map((link) => (
                        <a
                            key={link.href}
                            href={link.href}
                            className="sidebar-link"
                            onClick={() => setIsOpen(false)}
                        >
                            {link.label}
                        </a>
                    ))}
                </nav>
                <div
                    style={{
                        padding: "1.5rem 0 0 0",
                        display: "flex",
                        justifyContent: "center",
                    }}
                >
                    {isAuthenticated ? (
                        <div
                            style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "0.7rem",
                            }}
                        >
                            <a
                                href="/profile"
                                onClick={() => setIsOpen(false)}
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    textDecoration: "none",
                                }}
                            >
                                {avatar ? (
                                    <img
                                        src={avatar}
                                        alt="프로필"
                                        style={{
                                            width: 38,
                                            height: 38,
                                            borderRadius: "50%",
                                            border: "2px solid #e5e5e5",
                                            background: "#f5f5f5",
                                        }}
                                    />
                                ) : (
                                    <img
                                        src="/default-avatar.png"
                                        alt="기본 프로필"
                                        style={{
                                            width: 38,
                                            height: 38,
                                            borderRadius: "50%",
                                            border: "2px solid #e5e5e5",
                                            background: "#f5f5f5",
                                        }}
                                    />
                                )}
                            </a>
                            <button
                                onClick={async () => {
                                    setIsOpen(false);
                                    await logout();
                                }}
                                style={{
                                    background: "none",
                                    border: "none",
                                    color: "#666",
                                    fontWeight: 600,
                                    fontSize: "1rem",
                                    cursor: "pointer",
                                }}
                            >
                                로그아웃
                            </button>
                        </div>
                    ) : (
                        <a
                            href="/login"
                            title="로그인/회원가입"
                            className="nav-login-action"
                            onClick={() => setIsOpen(false)}
                        >
                            <button className="nav-login-btn-enhanced">
                                로그인 / 회원가입
                            </button>
                        </a>
                    )}
                </div>
            </aside>
        </>
    );
}
