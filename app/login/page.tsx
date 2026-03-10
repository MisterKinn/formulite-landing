"use client";
import React, { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Sparkles, Lock, Mail, ArrowLeft } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { Navbar } from "../../components/Navbar";
import Sidebar from "../(home)/SidebarDynamic";
import { getFirestore, doc, getDoc } from "firebase/firestore";
import {
    getFirebaseAppOrNull,
    getFirebaseClientConfigDiagnostics,
} from "../../firebaseConfig";
import {
    ADMIN_EMAIL,
    ADMIN_SESSION_STORAGE_KEY,
} from "@/lib/adminPortal";
import { normalizePlanLike } from "@/lib/userData";
import "./login.css";
import "../style.css";
import "../mobile.css";

const Login = () => {
    return (
        <React.Suspense fallback={<div>Loading...</div>}>
            <LoginContent />
        </React.Suspense>
    );
};

const EyeIcon = () => (
    <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
    >
        <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
        <circle cx="12" cy="12" r="3" />
    </svg>
);

const EyeOffIcon = () => (
    <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
    >
        <path d="m2 2 20 20" />
        <path d="M10.477 10.486a2 2 0 0 0 2.829 2.829" />
        <path d="M9.88 5.097A10.94 10.94 0 0 1 12 4.9c5.292 0 9.608 3.292 10.96 7.1a1.2 1.2 0 0 1 0 .8 11.06 11.06 0 0 1-5.14 6.19" />
        <path d="M6.61 6.617A11.05 11.05 0 0 0 1.04 12a1.2 1.2 0 0 0 0 .8 11.05 11.05 0 0 0 11 7.1 10.9 10.9 0 0 0 3.28-.49" />
    </svg>
);

function LoginContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const forceAccountSwitch =
        searchParams?.get("force_account_switch") === "1";
    const hasForcedLogoutRef = useRef(false);

    const {
        loginWithEmail,
        signupWithEmail,
        loginWithGoogle,
        requestPasswordReset,
        isAuthenticated,
        loading,
        logout,
    } = useAuth();

    const [form, setForm] = useState({
        email: "",
        password: "",
        confirmPassword: "",
    });
    const [error, setError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [info, setInfo] = useState<string | null>(null);
    const [signupMode, setSignupMode] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);

    useEffect(() => {
        const mode = searchParams?.get("mode");
        const signup = searchParams?.get("signup");
        setSignupMode(mode === "signup" || signup === "1");
    }, [searchParams]);

    useEffect(() => {
        const diagnostics = getFirebaseClientConfigDiagnostics();
        if (diagnostics.configured) return;
        setError(
            `Firebase 설정이 누락되었습니다. Vercel 환경변수(NEXT_PUBLIC_FIREBASE_*)를 확인해주세요. 누락 키: ${diagnostics.missingRequiredKeys.join(", ")}`,
        );
    }, []);

    useEffect(() => {
        // Desktop login flow can request explicit account switching.
        // Consume this flag exactly once after the first auth check:
        // - if already signed in, force a one-time logout
        // - if already signed out, do nothing (and never logout after a new login)
        if (!forceAccountSwitch || loading || hasForcedLogoutRef.current) return;
        hasForcedLogoutRef.current = true;
        if (!isAuthenticated) return;

        (async () => {
            try {
                await logout();
            } catch (err) {
                console.error("Forced logout for account switch failed:", err);
            }
        })();
    }, [forceAccountSwitch, loading, isAuthenticated, logout]);

    // Helper function to fetch canonical user plan from Firestore
    const getUserPlan = async (uid: string): Promise<string> => {
        try {
            const firebaseApp = getFirebaseAppOrNull();
            if (!firebaseApp) return "free";
            const db = getFirestore(firebaseApp);
            const docRef = doc(db, "users", uid);
            const snap = await getDoc(docRef);
            if (snap.exists()) {
                const data = snap.data();
                return normalizePlanLike(
                    data?.plan || data?.tier || data?.subscription?.plan,
                    "free",
                );
            }
        } catch (err) {
            console.error("Failed to fetch user plan:", err);
        }
        return "free";
    };

    // Helper function to handle redirect after successful login
    const handlePostLoginRedirect = async (user: any) => {
        const postLoginAction = searchParams?.get("postLoginAction");
        const amount = searchParams?.get("amount");
        const orderName = searchParams?.get("orderName");
        const redirectUri = searchParams?.get("redirect_uri");
        const sessionId = searchParams?.get("session");

        if (
            postLoginAction === "payment" &&
            amount &&
            orderName &&
            !Number.isNaN(Number(amount))
        ) {
            const paymentParams = new URLSearchParams({
                openPayment: "true",
                amount,
                orderName,
            });
            const billingCycle = searchParams?.get("billingCycle");
            if (billingCycle) {
                paymentParams.set("billingCycle", billingCycle);
            }
            window.location.href = `/?${paymentParams.toString()}`;
            return;
        }

        if (sessionId) {
            // Server-side OAuth flow for Python app
            try {
                // Fetch user plan from Firestore and expose it in both plan/tier keys
                const plan = await getUserPlan(user.uid);

                // Redirect to /auth-callback with user info and session ID
                // The auth-callback page will store info server-side
                const params = new URLSearchParams({
                    uid: user.uid || "",
                    name: user.displayName || user.email?.split("@")[0] || "",
                    email: user.email || "",
                    photo_url: user.photoURL || "",
                    tier: plan,
                    plan,
                    session: sessionId,
                });

                const callbackUrl = `/auth-callback?${params.toString()}`;
                window.location.href = callbackUrl;
                return;
            } catch (err) {
                console.error("Session redirect failed:", err);
                // Fall through to default redirect
            }
        }

        if (redirectUri) {
            try {
                // Validate that redirect_uri is a valid URL
                const url = new URL(redirectUri);

                // Fetch user plan from Firestore and expose it in both plan/tier keys
                const plan = await getUserPlan(user.uid);

                // Redirect to /auth-callback with user info and redirect_uri
                // The auth-callback page will then redirect to the external redirect_uri
                const params = new URLSearchParams({
                    uid: user.uid || "",
                    name: user.displayName || user.email?.split("@")[0] || "",
                    email: user.email || "",
                    photo_url: user.photoURL || "",
                    tier: plan,
                    plan,
                    redirect_uri: redirectUri,
                });

                const callbackUrl = `/auth-callback?${params.toString()}`;
                window.location.href = callbackUrl;
                return;
            } catch (err) {
                console.error("Invalid redirect_uri or redirect failed:", err);
                // Fall through to default redirect
            }
        }

        // Default redirect if no redirect_uri or if redirect failed
        window.location.href = "/";
    };

    useEffect(() => {
        if (!loading && isAuthenticated) {
            if (forceAccountSwitch) {
                return;
            }
            // If user is already logged in, handle redirect_uri or session
            const redirectUri = searchParams?.get("redirect_uri");
            const sessionId = searchParams?.get("session");

            if (redirectUri || sessionId) {
                // Get the current user and redirect with their info
                const firebaseApp = getFirebaseAppOrNull();
                if (!firebaseApp) return;
                const auth = require("firebase/auth").getAuth(firebaseApp);
                const currentUser = auth.currentUser;
                if (currentUser) {
                    handlePostLoginRedirect(currentUser);
                    return;
                }
            }
            window.location.href = "/";
        }
    }, [forceAccountSwitch, isAuthenticated, loading, searchParams]);

    const handleChange =
        (field: keyof typeof form) =>
        (event: React.ChangeEvent<HTMLInputElement>) => {
            setForm((prev) => ({ ...prev, [field]: event.target.value }));
        };

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        setError(null);
        setInfo(null);
        setSubmitting(true);
        try {
            if (signupMode) {
                if (form.password !== form.confirmPassword) {
                    setError("비밀번호가 일치하지 않습니다.");
                    setSubmitting(false);
                    return;
                }
                const user = await signupWithEmail(form.email, form.password);
                setInfo("회원가입이 완료되었습니다. 자동으로 로그인됩니다.");
                await handlePostLoginRedirect(user);
            } else {
                const normalizedEmail = form.email.trim().toLowerCase();
                if (normalizedEmail === ADMIN_EMAIL) {
                    const response = await fetch("/api/admin/login", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            email: normalizedEmail,
                            password: form.password,
                        }),
                    });
                    if (!response.ok) {
                        setError("관리자 비밀번호를 확인해주세요.");
                        setSubmitting(false);
                        return;
                    }
                    const data = await response.json();
                    if (typeof window !== "undefined") {
                        sessionStorage.setItem(
                            ADMIN_SESSION_STORAGE_KEY,
                            data.token,
                        );
                    }
                    window.location.href = "/admin";
                    return;
                }

                const user = await loginWithEmail(form.email, form.password);
                await handlePostLoginRedirect(user);
            }
        } catch (err: unknown) {
            console.error("Login failed", err);
            // Map common Firebase auth error codes to friendly messages
            const code =
                err && typeof err === "object"
                    ? (err as any).code || (err as any).message || ""
                    : "";
            const message =
                err && typeof err === "object"
                    ? (err as any).message || String(err)
                    : String(err);

            const invalidCredentialCodes = [
                "auth/wrong-password",
                "auth/invalid-credential",
                "INVALID_PASSWORD",
                "EMAIL_NOT_FOUND",
                "auth/user-not-found",
            ];

            if (
                invalidCredentialCodes.some((c) =>
                    String(code).toUpperCase().includes(String(c).toUpperCase())
                )
            ) {
                setError("이메일 또는 비밀번호가 올바르지 않습니다.");
            } else if (String(code).toLowerCase().includes("firebase_not_configured")) {
                setError(
                    "배포 환경의 Firebase 설정이 누락되었습니다. Vercel 프로젝트 환경변수(NEXT_PUBLIC_FIREBASE_*)를 설정한 뒤 재배포해주세요.",
                );
            } else if (
                String(code).toLowerCase().includes("unauthorized-domain") ||
                String(code).toLowerCase().includes("auth/operation-not-allowed")
            ) {
                setError(
                    "현재 배포 도메인이 Firebase 인증에 허용되지 않았거나 인증 방식이 비활성화되어 있습니다. Firebase Console > Authentication 설정을 확인해주세요.",
                );
            } else if (
                String(code).toLowerCase().includes("too-many-requests")
            ) {
                setError(
                    "너무 많은 시도가 있었습니다. 잠시 후 다시 시도해주세요."
                );
            } else {
                setError(`${code} — ${message}`);
            }
        } finally {
            setSubmitting(false);
        }
    };

    const handleGoogle = async () => {
        setError(null);
        setInfo(null);
        setSubmitting(true);
        try {
            const user = await loginWithGoogle();
            await handlePostLoginRedirect(user);
        } catch (err: unknown) {
            console.error("[Login] Google login failed", err);
            const code =
                err && typeof err === "object" ? (err as any).code || "" : "";
            const message =
                err && typeof err === "object"
                    ? (err as any).message || String(err)
                    : String(err);
            setError(`${code} — ${message}` || "Google 로그인에 실패했습니다.");
        } finally {
            setSubmitting(false);
        }
    };

    const handleReset = async () => {
        setError(null);
        setInfo(null);
        if (!form.email || !form.email.trim()) {
            setError("비밀번호 재설정을 위해 이메일을 입력해주세요.");
            return;
        }
        // basic email format check
        const email = form.email.trim();
        const emailRe = /\S+@\S+\.\S+/;
        if (!emailRe.test(email)) {
            setError("유효한 이메일 주소를 입력해주세요.");
            return;
        }

        setSubmitting(true);
        try {
            await requestPasswordReset(email);
            // generic success message (do not reveal account existence)
            setInfo(
                "입력하신 이메일로 비밀번호 재설정 링크가\n전송되었습니다. 이메일을 확인해주세요."
            );
            console.info("Password reset email requested for", email);
        } catch (err: unknown) {
            console.error("requestPasswordReset failed", err);
            // friendly messages for common cases
            const code =
                err && typeof err === "object"
                    ? (err as any).code || (err as any).message || ""
                    : "";
            if (String(code).toLowerCase().includes("too-many-requests")) {
                setError(
                    "너무 많은 요청이 있었습니다. 잠시 후 다시 시도해주세요."
                );
            } else if (
                String(code).toLowerCase().includes("server_misconfigured") ||
                String(code).toLowerCase().includes("servermisconfigured")
            ) {
                // Clear, actionable message for admin-misconfiguration
                setError(
                    "비밀번호 재설정 시스템에 문제가 있습니다. 관리자에게 문의해주세요."
                );
            } else if (
                String(code).toLowerCase().includes("generate_link_failed")
            ) {
                const parts = String(code).split(":");
                const eventId = parts[1] || "unknown";
                setError(
                    `비밀번호 재설정에 실패했습니다 (오류 ID: ${eventId}). 관리자에게 문의해주세요.`
                );
            } else {
                setError("재설정 요청에 실패했습니다. 다시 시도해주세요.");
            }
        } finally {
            setSubmitting(false);
        }
    };

    if (!loading && isAuthenticated) {
        return (
            <div className="login-outer-bg">
                <div className="login-container">
                    <div className="dashboard-card login-enhanced-card login-centered-card">
                        <h2 className="login-already-title">
                            이미 로그인되어 있습니다.
                        </h2>
                        <button
                            className="primary-button"
                            onClick={async () => {
                                await logout();
                            }}
                        >
                            로그아웃
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <>
            {/* Desktop Navbar */}
            <div className="login-navbar-desktop">
                <Navbar />
            </div>
            {/* Mobile Sidebar Button */}
            <div className="login-sidebar-mobile">
                <Sidebar />
            </div>
            <div className="login-container">
                <div
                    className={`login-enhanced-card login-centered-card${
                        signupMode ? " signup-mode" : " login-mode"
                    }${error ? " has-error" : ""}`}
                >
                    <header className="login-card__header login-header-no-margin">
                        <div className="login-header-stack">
                            <div className="login-title-main">
                                {signupMode ? "회원가입" : "로그인"}
                            </div>
                        </div>
                    </header>

                    {/* 소셜 로그인 버튼 */}
                    <div className="social-login-container">
                        <button
                            type="button"
                            className="social-btn google-btn"
                            onClick={handleGoogle}
                            disabled={submitting}
                        >
                            <svg
                                className="social-icon google-icon"
                                width="28"
                                height="28"
                                viewBox="0 0 20 20"
                                fill="none"
                                xmlns="http://www.w3.org/2000/svg"
                            >
                                <g clipPath="url(#clip0_993_771)">
                                    <path
                                        d="M19.805 10.2305C19.805 9.55078 19.7483 8.86719 19.6267 8.19922H10.2V12.0508H15.6408C15.4158 13.2812 14.6725 14.3359 13.6242 15.0352V17.2852H16.7283C18.5275 15.6172 19.805 13.1953 19.805 10.2305Z"
                                        fill="#4285F4"
                                    />
                                    <path
                                        d="M10.2 20C12.6992 20 14.7892 19.1797 16.3283 17.2852L13.6242 15.0352C12.7892 15.6016 11.6425 15.9609 10.2 15.9609C7.78917 15.9609 5.74917 14.2734 5.035 12.0508H1.82831V14.375C3.41748 17.6016 6.59917 20 10.2 20Z"
                                        fill="#34A853"
                                    />
                                    <path
                                        d="M5.035 12.0508C4.85165 11.4844 4.74831 10.8828 4.74831 10.25C4.74831 9.61719 4.85165 9.01562 5.035 8.44922V6.125H1.82831C1.20165 7.36719 0.845001 8.75781 0.845001 10.25C0.845001 11.7422 1.20165 13.1328 1.82831 14.375L5.035 12.0508Z"
                                        fill="#FBBC05"
                                    />
                                    <path
                                        d="M10.2 4.53906C11.4842 4.53906 12.6408 4.98438 13.5408 5.83594L16.3933 3.04688C14.7858 1.52344 12.6958 0.5 10.2 0.5C6.59917 0.5 3.41748 2.89844 1.82831 6.125L5.035 8.44922C5.74917 6.22656 7.78917 4.53906 10.2 4.53906Z"
                                        fill="#EA4335"
                                    />
                                </g>
                                <defs>
                                    <clipPath id="clip0_993_771">
                                        <rect
                                            width="20"
                                            height="20"
                                            fill="white"
                                        />
                                    </clipPath>
                                </defs>
                            </svg>
                            <span>Google로 계속하기</span>
                        </button>

                    </div>

                    {/* 구분선 */}
                    <div className="login-divider">
                        <span>또는</span>
                    </div>

                    <form className="login-form" onSubmit={handleSubmit}>
                        <label>
                            <span>이메일</span>
                            <div className="input-shell">
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
                                        x="2"
                                        y="4"
                                        width="20"
                                        height="16"
                                        rx="2"
                                    />
                                    <path d="m22 6-10 7L2 6" />
                                </svg>
                                <input
                                    type="email"
                                    placeholder="you@example.com"
                                    value={form.email}
                                    onChange={handleChange("email")}
                                    required
                                />
                            </div>
                        </label>
                        <label>
                            <span>비밀번호</span>
                            <div className="input-shell">
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
                                    type={showPassword ? "text" : "password"}
                                    placeholder="6자 이상 입력"
                                    value={form.password}
                                    onChange={handleChange("password")}
                                    required
                                />
                                <button
                                    type="button"
                                    className="password-toggle-btn"
                                    onClick={() =>
                                        setShowPassword((prev) => !prev)
                                    }
                                    aria-label={
                                        showPassword
                                            ? "비밀번호 숨기기"
                                            : "비밀번호 보기"
                                    }
                                >
                                    {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                                </button>
                            </div>
                        </label>

                        {!signupMode && (
                            <button
                                type="button"
                                className="forgot-password-btn"
                                onClick={handleReset}
                            >
                                비밀번호를 잊으셨나요?
                            </button>
                        )}

                        {signupMode && (
                            <label>
                                <span>비밀번호 확인</span>
                                <div className="input-shell">
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
                                        type={
                                            showConfirmPassword
                                                ? "text"
                                                : "password"
                                        }
                                        placeholder="비밀번호를 다시 입력해주세요"
                                        value={form.confirmPassword}
                                        onChange={handleChange(
                                            "confirmPassword"
                                        )}
                                        required
                                    />
                                    <button
                                        type="button"
                                        className="password-toggle-btn"
                                        onClick={() =>
                                            setShowConfirmPassword(
                                                (prev) => !prev,
                                            )
                                        }
                                        aria-label={
                                            showConfirmPassword
                                                ? "비밀번호 확인 숨기기"
                                                : "비밀번호 확인 보기"
                                        }
                                    >
                                        {showConfirmPassword ? (
                                            <EyeOffIcon />
                                        ) : (
                                            <EyeIcon />
                                        )}
                                    </button>
                                </div>
                            </label>
                        )}

                        {error && (
                            <div className="login-banner error">{error}</div>
                        )}
                        {info && (
                            <div className="login-banner info">{info}</div>
                        )}

                        <button
                            type="submit"
                            className="login-btn"
                            disabled={submitting}
                        >
                            {signupMode ? "회원가입" : "로그인"}
                        </button>
                    </form>

                    <div className="login-toggle login-toggle-row">
                        {signupMode ? (
                            <>
                                <span>이미 계정이 있으신가요?</span>
                                <button
                                    type="button"
                                    className="text-btn"
                                    onClick={() => setSignupMode(false)}
                                >
                                    로그인으로 이동
                                </button>
                            </>
                        ) : (
                            <>
                                <span>아직 계정이 없으신가요?</span>
                                <button
                                    type="button"
                                    className="text-btn"
                                    onClick={() => setSignupMode(true)}
                                >
                                    회원가입으로 이동
                                </button>
                            </>
                        )}
                    </div>
                </div>
            </div>
        </>
    );
}

export default Login;
