"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import {
    getAuth,
    EmailAuthProvider,
    reauthenticateWithCredential,
    updatePassword,
} from "firebase/auth";
import { Navbar } from "../../components/Navbar";
import dynamic from "next/dynamic";

import "./password-reset.css";
import "../style.css";
import "../mobile.css";

const Sidebar = dynamic(() => import("../../components/Sidebar"), {
    ssr: false,
});

export default function PasswordResetPage() {
    const router = useRouter();
    const [currentPassword, setCurrentPassword] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [error, setError] = useState("");
    const [success, setSuccess] = useState("");
    const [submitting, setSubmitting] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");
        setSuccess("");
        if (!currentPassword || !newPassword || !confirmPassword) {
            setError("모든 필드를 입력해 주세요.");
            return;
        }
        if (newPassword.length < 6) {
            setError("새 비밀번호는 6자 이상이어야 합니다.");
            return;
        }
        if (newPassword !== confirmPassword) {
            setError("새 비밀번호가 일치하지 않습니다.");
            return;
        }

        setSubmitting(true);
        try {
            const auth = getAuth();
            const user = auth.currentUser;
            if (!user || !user.email) {
                setError("로그인 후 비밀번호를 변경해주세요.");
                setSubmitting(false);
                return;
            }

            // Reauthenticate with current password
            const credential = EmailAuthProvider.credential(
                user.email,
                currentPassword
            );
            await reauthenticateWithCredential(user, credential);

            // Update password
            await updatePassword(user, newPassword);

            setSuccess("비밀번호가 성공적으로 변경되었습니다.");
            setCurrentPassword("");
            setNewPassword("");
            setConfirmPassword("");
            // Redirect to login after successful password change
            router.push("/login");
        } catch (err: any) {
            console.error("Password change failed", err);
            // Friendly error messages for common Firebase auth errors
            const code = err?.code || err?.message || "";
            if (
                code.includes("wrong-password") ||
                code.includes("INVALID_PASSWORD")
            ) {
                setError("현재 비밀번호가 올바르지 않습니다.");
            } else if (
                code.includes("weak-password") ||
                code.includes("WEAK_PASSWORD")
            ) {
                setError(
                    "새 비밀번호가 약합니다. 더 복잡한 비밀번호를 사용하세요."
                );
            } else if (code.includes("requires-recent-login")) {
                setError("보안을 위해 최근 로그인 후 다시 시도해주세요.");
            } else {
                setError("비밀번호 변경에 실패했습니다.");
            }
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <>
            <div className="desktop-navbar">
                <Navbar />
            </div>
            <div className="mobile-sidebar-container">
                <Sidebar />
            </div>
            <div className="password-reset-outer-bg">
                <div className="password-reset-container">
                    <div className="password-reset-card">
                        <div style={{ textAlign: "center" }}>
                            <h2 className="password-reset-title">
                                비밀번호 재설정
                            </h2>
                        </div>
                        <form
                            className="password-reset-form"
                            onSubmit={handleSubmit}
                        >
                            <label>
                                <span>현재 비밀번호</span>
                                <div className="password-reset-input">
                                    <svg
                                        width="18"
                                        height="18"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="2"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                    >
                                        <rect
                                            x="3"
                                            y="11"
                                            width="18"
                                            height="11"
                                            rx="2"
                                        />
                                        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                                    </svg>
                                    <input
                                        type="password"
                                        placeholder="현재 비밀번호"
                                        value={currentPassword}
                                        onChange={(e) =>
                                            setCurrentPassword(e.target.value)
                                        }
                                        autoComplete="current-password"
                                        disabled={submitting}
                                    />
                                </div>
                            </label>

                            <label>
                                <span>새 비밀번호</span>
                                <div className="password-reset-input">
                                    <svg
                                        width="18"
                                        height="18"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="2"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                    >
                                        <rect
                                            x="3"
                                            y="11"
                                            width="18"
                                            height="11"
                                            rx="2"
                                        />
                                        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                                    </svg>
                                    <input
                                        type="password"
                                        placeholder="새 비밀번호"
                                        value={newPassword}
                                        onChange={(e) =>
                                            setNewPassword(e.target.value)
                                        }
                                        autoComplete="new-password"
                                        disabled={submitting}
                                    />
                                </div>
                            </label>

                            <label>
                                <span>새 비밀번호 확인</span>
                                <div className="password-reset-input">
                                    <svg
                                        width="18"
                                        height="18"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="2"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                    >
                                        <rect
                                            x="3"
                                            y="11"
                                            width="18"
                                            height="11"
                                            rx="2"
                                        />
                                        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                                    </svg>
                                    <input
                                        type="password"
                                        placeholder="새 비밀번호 확인"
                                        value={confirmPassword}
                                        onChange={(e) =>
                                            setConfirmPassword(e.target.value)
                                        }
                                        autoComplete="new-password"
                                        disabled={submitting}
                                    />
                                </div>
                            </label>
                            {error && (
                                <div className="password-reset-message error">
                                    {error}
                                </div>
                            )}
                            {success && (
                                <div className="password-reset-message success">
                                    {success}
                                </div>
                            )}
                            <button
                                className="password-reset-btn"
                                type="submit"
                                disabled={submitting}
                            >
                                {submitting ? "변경 중..." : "비밀번호 변경"}
                            </button>
                        </form>
                        <button
                            className="password-reset-secondary-btn"
                            onClick={() => router.push("/login")}
                        >
                            로그인 페이지로 이동
                        </button>
                    </div>
                </div>
            </div>
        </>
    );
}
