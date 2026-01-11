"use client";
import React, { useState, useRef } from "react";
import { useAuth } from "../context/AuthContext";

export function Navbar() {
    const { isAuthenticated, avatar, logout, user } = useAuth();
    const [menuOpen, setMenuOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

    // Close menu on outside click
    React.useEffect(() => {
        if (!menuOpen) return;
        function handleClick(e: MouseEvent) {
            if (
                menuRef.current &&
                !menuRef.current.contains(e.target as Node)
            ) {
                setMenuOpen(false);
            }
        }
        document.addEventListener("mousedown", handleClick);
        return () => document.removeEventListener("mousedown", handleClick);
    }, [menuOpen]);

    return (
        <nav className="navbar animate-fade-in">
            <div className="navbar-inner">
                <a href="/" title="유노바" className="nav-brand no-hover">
                    <div className="brand-mark no-hover">
                        <img
                            src="../nova-logo.png"
                            alt="노바AI 로고"
                            className="brand-mark-img"
                        />
                    </div>
                </a>

                <div className="nav-items">
                    <a href="/#home" className="nav-link">
                        메인
                    </a>
                    <a href="/#benefits" className="nav-link">
                        강점
                    </a>
                    <a href="/#features" className="nav-link">
                        기능
                    </a>
                    <a href="/#testimonials" className="nav-link">
                        후기
                    </a>
                    <a href="/#pricing" className="nav-link">
                        요금제
                    </a>
                    <a href="/#faq" className="nav-link">
                        FAQ
                    </a>
                    <a href="/download" className="nav-download-gradient">
                        지금 다운로드
                    </a>
                </div>

                <div className="nav-actions-group">
                    {isAuthenticated ? (
                        <div className="nav-profile-menu-wrapper" ref={menuRef}>
                            <button
                                className="nav-profile-trigger"
                                aria-label="프로필 메뉴 열기"
                                onClick={() => setMenuOpen((v) => !v)}
                            >
                                <img
                                    src={avatar || "/default-avatar.png"}
                                    alt="프로필"
                                    className="nav-profile-avatar-img"
                                />
                                <div className="nav-profile-info">
                                    <span className="nav-profile-email">
                                        {user?.email || "사용자"}
                                    </span>
                                    <span className="nav-profile-plan">
                                        무료 플랜
                                    </span>
                                </div>
                                <svg
                                    className={`nav-profile-chevron ${
                                        menuOpen ? "open" : ""
                                    }`}
                                    width="16"
                                    height="16"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                >
                                    <polyline points="6 9 12 15 18 9"></polyline>
                                </svg>
                            </button>
                            {menuOpen && (
                                <div className="nav-profile-dropdown">
                                    <a
                                        href="/profile"
                                        className="nav-profile-dropdown-item"
                                    >
                                        <svg
                                            width="16"
                                            height="16"
                                            viewBox="0 0 24 24"
                                            fill="none"
                                            stroke="currentColor"
                                            strokeWidth="1.5"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                        >
                                            <circle cx="12" cy="8" r="4" />
                                            <path d="M6 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2" />
                                        </svg>
                                        <span>프로필</span>
                                    </a>
                                    <a
                                        href="/profile"
                                        className="nav-profile-dropdown-item"
                                        onClick={() => {
                                            sessionStorage.setItem(
                                                "profileTab",
                                                "subscription"
                                            );
                                        }}
                                    >
                                        <svg
                                            width="16"
                                            height="16"
                                            viewBox="0 0 24 24"
                                            fill="none"
                                            stroke="currentColor"
                                            strokeWidth="1.5"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                        >
                                            <rect
                                                x="2"
                                                y="5"
                                                width="20"
                                                height="14"
                                                rx="2"
                                            />
                                            <line
                                                x1="2"
                                                y1="10"
                                                x2="22"
                                                y2="10"
                                            />
                                        </svg>
                                        <span>요금제</span>
                                    </a>
                                    <a
                                        href="/profile"
                                        className="nav-profile-dropdown-item"
                                        onClick={() => {
                                            sessionStorage.setItem(
                                                "profileTab",
                                                "account"
                                            );
                                        }}
                                    >
                                        <svg
                                            width="16"
                                            height="16"
                                            viewBox="0 0 24 24"
                                            fill="none"
                                            stroke="currentColor"
                                            strokeWidth="1.5"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                        >
                                            <circle cx="12" cy="12" r="3" />
                                            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                                        </svg>
                                        <span>계정 설정</span>
                                    </a>
                                    <div className="nav-profile-dropdown-divider"></div>
                                    <button
                                        className="nav-profile-dropdown-item nav-profile-logout-btn"
                                        onClick={async () => {
                                            setMenuOpen(false);
                                            await logout();
                                        }}
                                    >
                                        <svg
                                            width="16"
                                            height="16"
                                            viewBox="0 0 24 24"
                                            fill="none"
                                            stroke="currentColor"
                                            strokeWidth="1.5"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                        >
                                            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                                            <polyline points="16 17 21 12 16 7" />
                                            <line
                                                x1="21"
                                                y1="12"
                                                x2="9"
                                                y2="12"
                                            />
                                        </svg>
                                        <span>로그아웃</span>
                                    </button>
                                </div>
                            )}
                        </div>
                    ) : (
                        <>
                            <a href="/login" className="nav-login-btn">
                                로그인
                            </a>
                            <a href="/download" className="nav-download-btn">
                                다운로드
                            </a>
                        </>
                    )}
                </div>
            </div>
        </nav>
    );
}
