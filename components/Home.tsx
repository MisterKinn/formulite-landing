"use client";
import React, { useEffect, useState } from "react";

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

type OSIconMap = {
    [key: string]: React.ReactNode;
};

const OS_ICONS: OSIconMap = {
    macOS: (
        <svg
            width="20"
            height="20"
            viewBox="0 0 1024 1024"
            fill="none"
            style={{ marginRight: 8, verticalAlign: "middle" }}
        >
            <path
                d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76.5 0-103.7 40.8-165.9 40.8s-105.6-57-155.5-127C46.7 790.7 0 663 0 541.8c0-194.4 126.4-297.5 250.8-297.5 66.1 0 121.2 43.4 162.7 43.4 39.5 0 101.1-46 176.3-46 28.5 0 130.9 2.6 198.3 99.2zm-234-181.5c31.1-36.9 53.1-88.1 53.1-139.3 0-7.1-.6-14.3-1.9-20.1-50.6 1.9-110.8 33.7-147.1 75.8-28.5 32.4-55.1 83.6-55.1 135.5 0 7.8 1.3 15.6 1.9 18.1 3.2.6 8.4 1.3 13.6 1.3 45.4 0 102.5-30.4 135.5-71.3z"
                fill="currentColor"
            />
        </svg>
    ),
    Windows: (
        <svg
            width="20"
            height="20"
            viewBox="0 0 48 48"
            fill="none"
            style={{ marginRight: 8, verticalAlign: "middle" }}
        >
            <rect width="48" height="48" rx="8" fill="#0078D6" />
            <path
                d="M22.5 10.5L6.5 12.5V23.5H22.5V10.5ZM22.5 25.5H6.5V36.5L22.5 38.5V25.5ZM24.5 10.3V23.5H41.5V7.5L24.5 10.3ZM41.5 25.5H24.5V38.7L41.5 41.1V25.5Z"
                fill="white"
            />
        </svg>
    ),
    Linux: (
        <svg
            width="20"
            height="20"
            viewBox="0 0 48 48"
            fill="none"
            style={{ marginRight: 8, verticalAlign: "middle" }}
        >
            <rect width="48" height="48" rx="8" fill="#333" />
            <ellipse cx="24" cy="34" rx="12" ry="6" fill="#F9D923" />
            <ellipse cx="24" cy="24" rx="10" ry="14" fill="#fff" />
            <ellipse cx="18" cy="20" rx="2" ry="3" fill="#333" />
            <ellipse cx="30" cy="20" rx="2" ry="3" fill="#333" />
            <ellipse cx="24" cy="30" rx="3" ry="2" fill="#333" />
        </svg>
    ),
};

const ArrowRightIcon = () => (
    <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ transition: "transform 0.2s ease" }}
    >
        <path d="M5 12h14" />
        <path d="m12 5 7 7-7 7" />
    </svg>
);

export default function Home() {
    const [os, setOS] = useState<ReturnType<typeof getOS>>("Other");
    const [typedText, setTypedText] = useState("");
    const fullText = "Nova AI";

    useEffect(() => {
        setOS(getOS());
    }, []);

    // Typing animation effect
    useEffect(() => {
        let timeoutId: NodeJS.Timeout;
        let isTyping = true;
        let currentIndex = 0;

        const animate = () => {
            if (isTyping) {
                // Typing phase
                if (currentIndex <= fullText.length) {
                    setTypedText(fullText.slice(0, currentIndex));
                    currentIndex++;
                    timeoutId = setTimeout(animate, 150);
                } else {
                    // Wait 3 seconds before deleting
                    timeoutId = setTimeout(() => {
                        isTyping = false;
                        currentIndex = fullText.length;
                        animate();
                    }, 3000);
                }
            } else {
                // Deleting phase
                if (currentIndex >= 0) {
                    setTypedText(fullText.slice(0, currentIndex));
                    currentIndex--;
                    timeoutId = setTimeout(animate, 100);
                } else {
                    // Wait a moment before retyping
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
        <section id="home" className="hero">
            <div className="hero-gradient-bg" />
            <div className="container">
                <div className="hero-stack">
                    <h1 className="title hero">
                        복잡한 한글 수식 입력
                        <br />
                        이제는{" "}
                        <span className="text-gradient">
                            {typedText}
                        </span>
                        <span className="typing-cursor"></span>
                        에게 맡기세요
                    </h1>
                    <p className="subtitle">
                        당신의 아이디어가 귀찮은 수식 입력으로 인해 끊기지 않도록,
                        <br />
                        Nova AI가 한글 파일을 자동으로 편집하고 관리합니다.
                    </p>

                    {os === "Android" || os === "iOS" ? null : (
                        <div className="hero-actions">
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
                            <a
                                href="/#features"
                                className="hero-text-link"
                            >
                                무엇을 할 수 있나요?
                            </a>
                        </div>
                    )}
                </div>
            </div>

            <div className="hero-image-wrap">
                <img
                    src="/main.png"
                    alt="Nova AI 인터페이스"
                    className="hero-main-image"
                />
            </div>
        </section>
    );
}
