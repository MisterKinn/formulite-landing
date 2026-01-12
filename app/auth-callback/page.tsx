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
            window.open('', '_self');
            window.close();
        } catch (e) {
            /* ignore */
        }

        // Final fallback: navigate to about:blank and then try closing again
        setTimeout(() => {
            try {
                window.location.href = 'about:blank';
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

            // Log to console
            console.log("Received user info:", info);

            // Store in localStorage for persistence
            localStorage.setItem(
                "lastLoginInfo",
                JSON.stringify({
                    ...info,
                    timestamp: new Date().toISOString(),
                })
            );

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
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
            <div className="max-w-2xl w-full bg-white rounded-lg shadow-lg p-8">
                <h1 className="text-3xl font-bold mb-8 text-center">
                    🔐 Login Callback
                </h1>

                {showInfo && userInfo ? (
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
                        </div>
                    </>
                ) : (
                    <div className="text-center py-12">
                        <p className="text-gray-500 text-lg">
                            Waiting for callback data...
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}
