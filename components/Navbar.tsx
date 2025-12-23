"use client";
import React, { useState, useRef } from "react";
import { useAuth } from "../context/AuthContext";

export function Navbar() {
    const { isAuthenticated, avatar, logout } = useAuth();
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
                <a href="/" title="Nova AI" className="nav-brand no-hover">
                    <div className="brand-mark no-hover">
                        <img
                            src="/nova-logo.png"
                            alt="Nova AI logo"
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
                </div>

                <div className="nav-actions-group">
                    {isAuthenticated ? (
                        <div className="nav-profile-menu-wrapper" ref={menuRef}>
                            <button
                                className="nav-profile-avatar-btn"
                                aria-label="프로필 메뉴 열기"
                                onClick={() => setMenuOpen((v) => !v)}
                            >
                                <img
                                    src={avatar || "/default-avatar.png"}
                                    alt="프로필"
                                    className="nav-profile-avatar-img"
                                />
                            </button>
                            {menuOpen && (
                                <div className="nav-profile-dropdown">
                                    <a
                                        href="/profile"
                                        className="nav-profile-dropdown-item"
                                    >
                                        프로필 편집
                                    </a>
                                    <button
                                        className="nav-profile-dropdown-item nav-profile-logout-btn"
                                        onClick={async () => {
                                            setMenuOpen(false);
                                            await logout();
                                        }}
                                    >
                                        로그아웃
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
