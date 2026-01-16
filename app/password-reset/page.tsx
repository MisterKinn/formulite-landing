"use client";

import React, { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
    getAuth,
    EmailAuthProvider,
    reauthenticateWithCredential,
    updatePassword,
    verifyPasswordResetCode,
    confirmPasswordReset,
} from "firebase/auth";
import { Navbar } from "../../components/Navbar";
import dynamic from "next/dynamic";

import "./password-reset.css";
import "../style.css";
import "../mobile.css";

const Sidebar = dynamic(() => import("../../components/Sidebar"), {
    ssr: false,
});

function PasswordResetContent() {
    const router = useRouter();
    const [currentPassword, setCurrentPassword] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [oobEmail, setOobEmail] = useState<string | null>(null);
    const [isOobFlow, setIsOobFlow] = useState(false);
    const [verifying, setVerifying] = useState(false);
    const [error, setError] = useState("");
    const [success, setSuccess] = useState("");
    const [submitting, setSubmitting] = useState(false);

    const searchParams = useSearchParams();
    const oobCode = searchParams?.get("oobCode");
    const mode = searchParams?.get("mode");

    useEffect(() => {
        // If this page is opened from the Firebase reset link, verify the oobCode
        if (oobCode && mode === "resetPassword") {
            setIsOobFlow(true);
            setVerifying(true);
            (async () => {
                try {
                    const auth = getAuth();
                    const email = await verifyPasswordResetCode(auth, oobCode);
                    setOobEmail(email || null);
                } catch (err: any) {
                    console.error("Invalid or expired reset code", err);
                    setError("유효하지 않거나 만료된 재설정 코드입니다.");
                } finally {
                    setVerifying(false);
                }
            })();
        }
    }, [oobCode, mode]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");
        setSuccess("");

        if (isOobFlow) {
            if (!newPassword || !confirmPassword) {
                setError("모든 필드를 입력해 주세요.");
                return;
            }
        } else {
            if (!currentPassword || !newPassword || !confirmPassword) {
                setError("모든 필드를 입력해 주세요.");
                return;
            }
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
            // If we're handling an OOB flow from email link, confirm the password reset using the code
            if (isOobFlow && oobCode) {
                await confirmPasswordReset(getAuth(), oobCode, newPassword);

                setSuccess("비밀번호가 성공적으로 변경되었습니다.");
                setNewPassword("");
                setConfirmPassword("");

                // Fire-and-forget: notify user via server-side email that their password changed
                (async () => {
                    try {
                        await fetch("/api/auth/password-changed", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ email: oobEmail }),
                        });
                    } catch (err) {
                        console.error(
                            "Failed to send password change notification:",
                            err
                        );
                    }
                })();

                // Redirect to login after successful password change
                router.push("/login");
                return;
            }

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

            // Fire-and-forget: notify user via server-side email that their password changed
            (async () => {
                try {
                    await fetch("/api/auth/password-changed", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ email: user.email }),
                    });
                } catch (err) {
                    console.error(
                        "Failed to send password change notification:",
                        err
                    );
                }
            })();

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
                        {/* If this is a reset-from-email flow (oob), show the reset form that only requests a new password */}
                        {isOobFlow ? (
                            <div>
                                {verifying ? (
                                    <p>링크를 확인 중입니다…</p>
                                ) : (
                                    <>
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
                                                        setNewPassword(
                                                            e.target.value
                                                        )
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
                                                        setConfirmPassword(
                                                            e.target.value
                                                        )
                                                    }
                                                    autoComplete="new-password"
                                                    disabled={submitting}
                                                />
                                            </div>
                                        </label>

                                        {oobEmail && (
                                            <div
                                                style={{
                                                    fontSize: 13,
                                                    marginBottom: 8,
                                                }}
                                            >
                                                재설정할 계정:{" "}
                                                <strong>{oobEmail}</strong>
                                            </div>
                                        )}

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
                                            onClick={handleSubmit}
                                            disabled={submitting}
                                        >
                                            {submitting
                                                ? "변경 중..."
                                                : "비밀번호 재설정"}
                                        </button>
                                    </>
                                )}
                            </div>
                        ) : (
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
                                                setCurrentPassword(
                                                    e.target.value
                                                )
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
                                                setConfirmPassword(
                                                    e.target.value
                                                )
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
                                    {submitting
                                        ? "변경 중..."
                                        : "비밀번호 변경"}
                                </button>
                            </form>
                        )}
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

export default function PasswordResetPage() {
    return (
        <Suspense
            fallback={
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
                                <h2 className="password-reset-title">
                                    로딩 중...
                                </h2>
                            </div>
                        </div>
                    </div>
                </>
            }
        >
            <PasswordResetContent />
        </Suspense>
    );
}
