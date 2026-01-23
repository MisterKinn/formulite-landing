"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

function getOS(): "Windows" | "macOS" | "Linux" | "Android" | "iOS" | "Other" {
    if (typeof window === "undefined") return "Other";
    const { userAgent, platform } = window.navigator;
    const macosPlatforms = ["Macintosh", "MacIntel", "MacPPC", "Mac68K"];
    const windowsPlatforms = ["Win32", "Win64", "Windows", "WinCE"];
    const iosPlatforms = ["iPhone", "iPad", "iPod"];
    if (macosPlatforms.includes(platform)) return "macOS";
    if (iosPlatforms.includes(platform)) return "iOS";
    if (windowsPlatforms.includes(platform)) return "Windows";
    if (/Android/.test(userAgent)) return "Android";
    if (/Linux/.test(platform)) return "Linux";
    return "Other";
}

export default function CTA() {
    const router = useRouter();
    const [typedText, setTypedText] = useState("");
    const [os, setOS] = useState<ReturnType<typeof getOS>>("Other");

    useEffect(() => {
        setOS(getOS());
    }, []);

    const handleDownload = (downloadUrl: string) => {
        // Start the download
        const link = document.createElement("a");
        link.href = downloadUrl;
        link.download = "";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        // Redirect to download page
        router.push("/download");
    };

    useEffect(() => {
        const fullText = "Nova AI";
        let timeoutId: NodeJS.Timeout;
        let isTyping = true;
        let currentIndex = 0;

        const animate = () => {
            if (isTyping) {
                if (currentIndex <= fullText.length) {
                    setTypedText(fullText.slice(0, currentIndex));
                    currentIndex++;
                    timeoutId = setTimeout(animate, 150);
                } else {
                    timeoutId = setTimeout(() => {
                        isTyping = false;
                        currentIndex = fullText.length;
                        animate();
                    }, 3000);
                }
            } else {
                if (currentIndex >= 0) {
                    setTypedText(fullText.slice(0, currentIndex));
                    currentIndex--;
                    timeoutId = setTimeout(animate, 100);
                } else {
                    timeoutId = setTimeout(() => {
                        isTyping = true;
                        currentIndex = 0;
                        animate();
                    }, 500);
                }
            }
        };

        animate();

        return () => clearTimeout(timeoutId);
    }, []);

    return (
        <section className="section-cta">
            <div className="section-inner container-narrow text-center">
                <h2 className="benefits-title mb-6">
                    <span className="text-gradient">{typedText}</span>
                    <span className="typing-cursor"></span>
                    가 당신의 한글 문서를
                    <br />
                    완벽하게 처리합니다
                </h2>
                <p className="benefits-subtitle mb-10">
                    수식 입력, 표 작성, 문서 편집까지 모두 Nova AI가
                    해결해드립니다.
                </p>

                <div className="cta-buttons">
                    {os === "Android" || os === "iOS" ? (
                        <a href="/download" style={{ textDecoration: "none" }}>
                            <button className="primary-button">
                                다운로드
                                <svg
                                    width="20"
                                    height="20"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                >
                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                    <polyline points="7 10 12 15 17 10" />
                                    <line x1="12" y1="15" x2="12" y2="3" />
                                </svg>
                            </button>
                        </a>
                    ) : os === "macOS" ? (
                        <button
                            className="primary-button"
                            onClick={() =>
                                handleDownload(
                                    "https://github.com/MisterKinn/formulite-landing/releases/download/v1.0.0/Nova.AI.dmg",
                                )
                            }
                        >
                            <svg
                                width="22"
                                height="22"
                                viewBox="0 0 24 24"
                                fill="currentColor"
                            >
                                <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
                            </svg>
                            macOS용 다운로드
                        </button>
                    ) : (
                        <button
                            className="primary-button"
                            onClick={() =>
                                handleDownload(
                                    "https://github.com/MisterKinn/formulite-landing/releases/download/v1.0.0/Nova.AI.Setup.exe",
                                )
                            }
                        >
                            <svg
                                width="18"
                                height="18"
                                viewBox="0 0 24 24"
                                fill="currentColor"
                            >
                                <path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-12.9-1.801" />
                            </svg>
                            Windows용 다운로드
                        </button>
                    )}
                </div>
            </div>
        </section>
    );
}
