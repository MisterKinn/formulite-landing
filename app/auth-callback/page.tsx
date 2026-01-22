"use client";
import React, { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";

interface UserInfo {
    uid: string | null;
    name: string | null;
    email: string | null;
    photo_url: string | null;
    tier: string | null;
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
        const redirectUri = searchParams?.get("redirect_uri") ?? null;
        const sessionId = searchParams?.get("session") ?? null;

        if (uid || email) {
            const info: UserInfo = {
                uid,
                name,
                email,
                photo_url: photoUrl,
                tier,
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
                        tier,
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
                if (tier) redirectUrl.searchParams.set("tier", tier);

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
            className="min-h-screen flex items-center justify-center p-4"
            style={{
                background: "#000000",
            }}
        >
            <div className="max-w-lg w-full text-center">
                {!showInfo && userInfo ? (
                    // Desktop app session - show simple success message
                    <div className="space-y-8">
                        <div className="inline-flex items-center justify-center w-24 h-24 rounded-full bg-white/10 backdrop-blur-sm">
                            <svg
                                className="w-12 h-12 text-white"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                            >
                                <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M5 13l4 4L19 7"
                                />
                            </svg>
                        </div>
                        <div className="space-y-4">
                            <h1 className="text-5xl font-light text-white tracking-tight">
                                Login Complete
                            </h1>
                            <p className="text-xl text-gray-400 font-light">
                                You can close this window
                            </p>
                        </div>
                        <div className="pt-4">
                            <p className="text-sm text-gray-500 font-mono">
                                Closing in {countdown}s
                            </p>
                        </div>
                    </div>
                ) : showInfo && userInfo ? (
                    // Regular web session - show detailed info
                    <>
                        <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg">
                            <p className="text-green-800 font-semibold">
                                ✅ Login successful! Window will close in{" "}
                                <span className="text-blue-600 font-bold">
                                    {countdown}
                                </span>{" "}
                                seconds...
                            </p>
                        </div>

                        <div className="space-y-4 mb-8">
                            <h2 className="text-xl font-semibold text-gray-900">
                                Received User Info:
                            </h2>

                            <div className="bg-gray-50 rounded-lg p-4 space-y-3">
                                <div className="flex items-start">
                                    <span className="font-semibold text-gray-700 w-24">
                                        UID:
                                    </span>
                                    <span className="text-gray-900 font-mono text-sm break-all">
                                        {userInfo.uid || "N/A"}
                                    </span>
                                </div>
                                <div className="flex items-start">
                                    <span className="font-semibold text-gray-700 w-24">
                                        Name:
                                    </span>
                                    <span className="text-gray-900">
                                        {userInfo.name || "N/A"}
                                    </span>
                                </div>
                                <div className="flex items-start">
                                    <span className="font-semibold text-gray-700 w-24">
                                        Email:
                                    </span>
                                    <span className="text-gray-900">
                                        {userInfo.email || "N/A"}
                                    </span>
                                </div>
                                <div className="flex items-start">
                                    <span className="font-semibold text-gray-700 w-24">
                                        Photo URL:
                                    </span>
                                    <span className="text-gray-900 font-mono text-sm break-all">
                                        {userInfo.photo_url || "N/A"}
                                    </span>
                                </div>
                                <div className="flex items-start">
                                    <span className="font-semibold text-gray-700 w-24">
                                        Tier:
                                    </span>
                                    <span className="text-gray-900 px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm font-medium w-fit">
                                        {userInfo.tier || "N/A"}
                                    </span>
                                </div>
                            </div>

                            {userInfo.photo_url && (
                                <div>
                                    <h3 className="font-semibold text-gray-900 mb-2">
                                        Profile Photo:
                                    </h3>
                                    <img
                                        src={userInfo.photo_url}
                                        alt="User profile"
                                        className="w-24 h-24 rounded-full object-cover border-2 border-gray-200"
                                        onError={(e) => {
                                            (
                                                e.target as HTMLImageElement
                                            ).style.display = "none";
                                        }}
                                    />
                                </div>
                            )}
                        </div>

                        <div className="text-center">
                            <button
                                onClick={() => tryClose()}
                                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                            >
                                Close Window
                            </button>
                            <p className="text-sm text-gray-400 mt-3">
                                Served by{" "}
                                <strong>app/auth-callback/page.tsx</strong>
                            </p>
                        </div>
                    </>
                ) : (
                    <div>
                        <div className="text-4xl mb-4">🔐</div>
                        <h1 className="text-2xl font-bold mb-4 text-gray-900">
                            Login Callback
                        </h1>
                        <p className="text-gray-500">
                            Processing authentication...
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}
