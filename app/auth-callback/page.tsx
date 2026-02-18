"use client";
import React, { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";

interface UserInfo {
    uid: string | null;
    name: string | null;
    email: string | null;
    photo_url: string | null;
    tier: string | null;
    plan: string | null;
}

export default function AuthCallback() {
    const router = useRouter();
    const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
    const [countdown, setCountdown] = useState(3);
    const [showInfo, setShowInfo] = useState(false);

    // Suspense boundary for useSearchParams
    return (
        <React.Suspense fallback={<div>Loading...</div>}>
            <AuthCallbackContent
                setUserInfo={setUserInfo}
                setShowInfo={setShowInfo}
                setCountdown={setCountdown}
                userInfo={userInfo}
                countdown={countdown}
                showInfo={showInfo}
            />
        </React.Suspense>
    );
}

function AuthCallbackContent({
    setUserInfo,
    setShowInfo,
    setCountdown,
    userInfo,
    countdown,
    showInfo,
}: {
    setUserInfo: React.Dispatch<React.SetStateAction<UserInfo | null>>;
    setShowInfo: React.Dispatch<React.SetStateAction<boolean>>;
    setCountdown: React.Dispatch<React.SetStateAction<number>>;
    userInfo: UserInfo | null;
    countdown: number;
    showInfo: boolean;
}) {
    const searchParams = useSearchParams();

    // Helper that attempts multiple fallbacks to close the popup reliably
    const tryClose = () => {
        try {
            window.close();
        } catch (e) {
            /* ignore */
        }

        // Some browsers block window.close() for windows not opened by script.
        // Attempt common fallbacks that sometimes allow closing in those cases.
        try {
            window.open("", "_self");
            window.close();
        } catch (e) {
            /* ignore */
        }

        // Final fallback: navigate to about:blank and then try closing again
        setTimeout(() => {
            try {
                window.location.href = "about:blank";
                window.close();
            } catch (e) {
                /* ignore */
            }
        }, 200);
    };

    useEffect(() => {
        // Parse query parameters
        const uid = searchParams?.get("uid") ?? null;
        const name = searchParams?.get("name") ?? null;
        const email = searchParams?.get("email") ?? null;
        const photoUrl = searchParams?.get("photo_url") ?? null;
        const tier = searchParams?.get("tier") ?? null;
        const plan = searchParams?.get("plan") ?? tier ?? null;
        const redirectUri = searchParams?.get("redirect_uri") ?? null;
        const sessionId = searchParams?.get("session") ?? null;

        if (uid || email) {
            const info: UserInfo = {
                uid,
                name,
                email,
                photo_url: photoUrl,
                tier: tier ?? plan,
                plan,
            };
            setUserInfo(info);
            setShowInfo(true);

            // Store in localStorage for persistence
            localStorage.setItem(
                "lastLoginInfo",
                JSON.stringify({
                    ...info,
                    timestamp: new Date().toISOString(),
                }),
            );

            // If session ID is provided, store user info server-side for desktop app
            if (sessionId) {
                console.log("Desktop session detected:", sessionId);
                fetch("/api/auth/complete-session", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        sessionId,
                        uid,
                        name,
                        email,
                        photoUrl,
                        tier: tier ?? plan,
                        plan,
                    }),
                })
                    .then((response) => {
                        if (!response.ok) {
                            console.error(
                                "Failed to complete session:",
                                response.status,
                            );
                            return response.json().then((data) => {
                                console.error("Error details:", data);
                                throw new Error(
                                    data.error || "Failed to complete session",
                                );
                            });
                        }
                        return response.json();
                    })
                    .then((data) => {
                        console.log("Session completed successfully:", data);
                        // Don't show detailed info for desktop sessions
                        setShowInfo(false);
                        // Auto-close after 3 seconds
                        setCountdown(3);
                        const timer = setInterval(() => {
                            setCountdown((prev) => {
                                if (prev <= 1) {
                                    clearInterval(timer);
                                    tryClose();
                                    return 0;
                                }
                                return prev - 1;
                            });
                        }, 1000);
                    })
                    .catch((error) => {
                        console.error("Session completion error:", error);
                    });
                return;
            }

            // If redirect_uri is provided, redirect there with user info
            if (redirectUri) {
                const redirectUrl = new URL(redirectUri);
                if (uid) redirectUrl.searchParams.set("uid", uid);
                if (name) redirectUrl.searchParams.set("name", name);
                if (email) redirectUrl.searchParams.set("email", email);
                if (photoUrl)
                    redirectUrl.searchParams.set("photo_url", photoUrl);
                const selectedTier = tier ?? plan;
                if (selectedTier) redirectUrl.searchParams.set("tier", selectedTier);
                if (plan) redirectUrl.searchParams.set("plan", plan);

                window.location.href = redirectUrl.toString();
                return;
            }

            // Start countdown to close window
            const timer = setInterval(() => {
                setCountdown((prev) => {
                    if (prev <= 1) {
                        clearInterval(timer);
                        // Try to close the window with robust fallbacks
                        setTimeout(() => {
                            tryClose();
                        }, 500);
                        return 0;
                    }
                    return prev - 1;
                });
            }, 1000);

            return () => clearInterval(timer);
        }
    }, [searchParams]);

    return (
        <div
            className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden"
            style={{
                background: "#0a0a0f",
            }}
        >
            {/* Ambient background glow */}
            <div
                className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full opacity-20 blur-[120px] pointer-events-none"
                style={{
                    background: "radial-gradient(circle, #6366f1 0%, #8b5cf6 40%, transparent 70%)",
                }}
            />
            <div
                className="absolute top-1/4 right-1/4 w-[300px] h-[300px] rounded-full opacity-10 blur-[80px] pointer-events-none"
                style={{
                    background: "radial-gradient(circle, #06b6d4 0%, transparent 70%)",
                }}
            />

            {/* Subtle grid pattern */}
            <div
                className="absolute inset-0 opacity-[0.03] pointer-events-none"
                style={{
                    backgroundImage: `linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px),
                                      linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)`,
                    backgroundSize: "60px 60px",
                }}
            />

            <style jsx>{`
                @keyframes checkDraw {
                    0% { stroke-dashoffset: 24; opacity: 0; }
                    40% { opacity: 1; }
                    100% { stroke-dashoffset: 0; opacity: 1; }
                }
                @keyframes scaleIn {
                    0% { transform: scale(0.8); opacity: 0; }
                    100% { transform: scale(1); opacity: 1; }
                }
                @keyframes fadeUp {
                    0% { transform: translateY(12px); opacity: 0; }
                    100% { transform: translateY(0); opacity: 1; }
                }
                @keyframes ringPulse {
                    0% { transform: scale(1); opacity: 0.4; }
                    100% { transform: scale(1.8); opacity: 0; }
                }
                @keyframes shimmer {
                    0% { background-position: -200% center; }
                    100% { background-position: 200% center; }
                }
                .check-draw {
                    stroke-dasharray: 24;
                    stroke-dashoffset: 24;
                    animation: checkDraw 0.6s ease-out 0.3s forwards;
                }
                .scale-in {
                    animation: scaleIn 0.4s ease-out forwards;
                }
                .fade-up-1 {
                    opacity: 0;
                    animation: fadeUp 0.5s ease-out 0.6s forwards;
                }
                .fade-up-2 {
                    opacity: 0;
                    animation: fadeUp 0.5s ease-out 0.8s forwards;
                }
                .fade-up-3 {
                    opacity: 0;
                    animation: fadeUp 0.5s ease-out 1.0s forwards;
                }
                .ring-pulse {
                    animation: ringPulse 2s ease-out infinite;
                }
                .shimmer-text {
                    background: linear-gradient(90deg, #e2e8f0 0%, #f8fafc 50%, #e2e8f0 100%);
                    background-size: 200% auto;
                    -webkit-background-clip: text;
                    -webkit-text-fill-color: transparent;
                    background-clip: text;
                    animation: shimmer 3s linear infinite;
                }
            `}</style>

            <div className="max-w-lg w-full text-center relative z-10">
                {!showInfo && userInfo ? (
                    // Desktop app session - show simple success message
                    <div className="space-y-8">
                        {/* Success icon with animated ring */}
                        <div className="relative inline-flex items-center justify-center">
                            <div className="absolute w-28 h-28 rounded-full border border-emerald-500/30 ring-pulse" />
                            <div
                                className="relative w-24 h-24 rounded-full flex items-center justify-center scale-in"
                                style={{
                                    background: "linear-gradient(135deg, rgba(16,185,129,0.2) 0%, rgba(99,102,241,0.2) 100%)",
                                    border: "1px solid rgba(16,185,129,0.3)",
                                    boxShadow: "0 0 40px rgba(16,185,129,0.15), inset 0 1px 0 rgba(255,255,255,0.05)",
                                }}
                            >
                                <svg
                                    className="w-10 h-10"
                                    fill="none"
                                    viewBox="0 0 24 24"
                                    style={{ filter: "drop-shadow(0 0 8px rgba(16,185,129,0.5))" }}
                                >
                                    <path
                                        className="check-draw"
                                        stroke="#10b981"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={2.5}
                                        d="M5 13l4 4L19 7"
                                    />
                                </svg>
                            </div>
                        </div>

                        <div className="space-y-3 fade-up-1">
                            <h1 className="text-4xl font-semibold tracking-tight shimmer-text">
                                Login Complete
                            </h1>
                            <p className="text-base text-gray-400 font-light">
                                You can close this window and return to Nova AI
                            </p>
                        </div>

                        <div className="pt-2 fade-up-2">
                            <div
                                className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm"
                                style={{
                                    background: "rgba(255,255,255,0.04)",
                                    border: "1px solid rgba(255,255,255,0.08)",
                                }}
                            >
                                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                <span className="text-gray-400 font-mono text-xs">
                                    Closing in {countdown}s
                                </span>
                            </div>
                        </div>
                    </div>
                ) : showInfo && userInfo ? (
                    // Regular web session - show detailed info (dark mode)
                    <div className="space-y-6">
                        {/* Success banner */}
                        <div
                            className="p-4 rounded-xl fade-up-1"
                            style={{
                                background: "linear-gradient(135deg, rgba(16,185,129,0.1) 0%, rgba(99,102,241,0.08) 100%)",
                                border: "1px solid rgba(16,185,129,0.2)",
                            }}
                        >
                            <div className="flex items-center justify-center gap-3">
                                <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center flex-shrink-0">
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24">
                                        <path
                                            className="check-draw"
                                            stroke="#10b981"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            strokeWidth={2.5}
                                            d="M5 13l4 4L19 7"
                                        />
                                    </svg>
                                </div>
                                <p className="text-emerald-300 font-medium text-sm">
                                    Login successful! Closing in{" "}
                                    <span className="text-white font-bold tabular-nums">
                                        {countdown}
                                    </span>
                                    s
                                </p>
                            </div>
                        </div>

                        {/* User info card */}
                        <div
                            className="rounded-2xl p-6 space-y-5 fade-up-2"
                            style={{
                                background: "rgba(255,255,255,0.03)",
                                border: "1px solid rgba(255,255,255,0.07)",
                                backdropFilter: "blur(20px)",
                            }}
                        >
                            {/* Profile header */}
                            <div className="flex items-center gap-4 pb-4" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                                {userInfo.photo_url ? (
                                    <img
                                        src={userInfo.photo_url}
                                        alt="Profile"
                                        className="w-14 h-14 rounded-full object-cover ring-2 ring-indigo-500/30"
                                        onError={(e) => {
                                            (e.target as HTMLImageElement).style.display = "none";
                                        }}
                                    />
                                ) : (
                                    <div className="w-14 h-14 rounded-full bg-gradient-to-br from-indigo-500/30 to-purple-500/30 flex items-center justify-center ring-2 ring-indigo-500/20">
                                        <span className="text-xl text-white/80">
                                            {userInfo.name?.[0]?.toUpperCase() || "?"}
                                        </span>
                                    </div>
                                )}
                                <div className="text-left">
                                    <h2 className="text-lg font-semibold text-white">
                                        {userInfo.name || "User"}
                                    </h2>
                                    <p className="text-sm text-gray-400">
                                        {userInfo.email || "No email"}
                                    </p>
                                </div>
                            </div>

                            {/* Info rows */}
                            <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                    <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                                        UID
                                    </span>
                                    <span className="text-sm text-gray-300 font-mono truncate max-w-[240px]">
                                        {userInfo.uid || "N/A"}
                                    </span>
                                </div>
                                <div className="flex items-center justify-between">
                                    <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                                        Tier
                                    </span>
                                    <span
                                        className="text-xs font-medium px-3 py-1 rounded-full"
                                        style={{
                                            background: "rgba(99,102,241,0.15)",
                                            color: "#a5b4fc",
                                            border: "1px solid rgba(99,102,241,0.25)",
                                        }}
                                    >
                                        {userInfo.tier || "N/A"}
                                    </span>
                                </div>
                                <div className="flex items-center justify-between">
                                    <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                                        Plan
                                    </span>
                                    <span
                                        className="text-xs font-medium px-3 py-1 rounded-full"
                                        style={{
                                            background: "rgba(139,92,246,0.15)",
                                            color: "#c4b5fd",
                                            border: "1px solid rgba(139,92,246,0.25)",
                                        }}
                                    >
                                        {userInfo.plan || "N/A"}
                                    </span>
                                </div>
                            </div>
                        </div>

                        {/* Close button */}
                        <div className="fade-up-3">
                            <button
                                onClick={() => tryClose()}
                                className="px-8 py-2.5 rounded-xl text-sm font-medium text-white transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
                                style={{
                                    background: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)",
                                    boxShadow: "0 4px 20px rgba(99,102,241,0.3), inset 0 1px 0 rgba(255,255,255,0.1)",
                                }}
                            >
                                Close Window
                            </button>
                        </div>
                    </div>
                ) : (
                    // Loading state
                    <div className="space-y-6">
                        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full"
                            style={{
                                background: "rgba(255,255,255,0.04)",
                                border: "1px solid rgba(255,255,255,0.08)",
                            }}
                        >
                            <svg className="w-7 h-7 text-indigo-400 animate-spin" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                            </svg>
                        </div>
                        <div className="space-y-2">
                            <h1 className="text-2xl font-semibold text-white">
                                Authenticating
                            </h1>
                            <p className="text-gray-500 text-sm">
                                Processing your login...
                            </p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
