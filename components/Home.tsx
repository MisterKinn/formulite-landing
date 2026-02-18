"use client";
import React, { useEffect, useState } from "react";
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
    const router = useRouter();
    const [os, setOS] = useState<ReturnType<typeof getOS>>("Other");
    const [typedText, setTypedText] = useState("");
    const [selectedProcessImage, setSelectedProcessImage] = useState<{
        src: string;
        alt: string;
    } | null>(null);
    const fullText = "Nova AI";
    const processSteps = [
        {
            step: "1",
            label: "사진 업로드",
            image: "/main1.png",
            alt: "사진 드래그앤드롭",
            description:
                "사진을 드래그 앤 드롭 또는 Ctrl C+V로 넣어주세요. 여러 개의 이미지 파일이 등록 가능합니다.",
        },
        {
            step: "2",
            label: "AI 코드 생성",
            image: "/main2.png",
            alt: "AI 코드 생성 중",
            description:
                "보내기 버튼을 누르면 AI 코드가 생성되며, 코드 보내기, 코드 재입력, 코드 삭제가 가능합니다.",
        },
        {
            step: "3",
            label: "자동 타이핑",
            image: "/main3.png",
            alt: "타이핑 진행 중",
            description:
                "병렬로 호출된 AI가 코드를 저장하고, 순서대로 위에서 아래로 내용을 입력합니다.",
        },
        {
            step: "4",
            label: "완성된 문서",
            image: "/main4.png",
            alt: "한글 문서 결과",
            description:
                "완성된 문서를 확인하시고 디테일한 부분은 수정해주시면 됩니다. OCR 인식이라 완벽하게 사람처럼 정확하지는 않습니다.",
        },
    ];

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

    useEffect(() => {
        if (!selectedProcessImage) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                setSelectedProcessImage(null);
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [selectedProcessImage]);

    return (
        <section id="home" className="hero">
            <div className="hero-gradient-bg" />
            <div className="container">
                <div className="hero-stack">
                    <h1 className="title hero">
                        복잡한 한글 수식 입력
                        <br />
                        이제는{" "}
                        <span className="text-gradient">{typedText}</span>
                        <span className="typing-cursor"></span>
                        에게 맡기세요
                    </h1>
                    <p className="subtitle">
                        당신의 아이디어가 귀찮은 수식 입력으로 인해 끊기지
                        않도록,
                        <br />
                        Nova AI가 한글 파일을 자동으로 편집하고 관리합니다.
                    </p>

                    <div className="hero-actions">
                        {os === "Android" || os === "iOS" ? (
                            <a
                                href="/download"
                                style={{ textDecoration: "none" }}
                            >
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
                                        "https://github.com/MisterKinn/formulite-landing/releases/download/v1.0.0/nova-ai-setup-mac.dmg",
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
                                        "https://storage.googleapis.com/physics2/NovaAI_Setup_1.0.0.exe",
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
                        <a href="/#features" className="hero-text-link">
                            무엇을 할 수 있나요?
                        </a>
                    </div>
                </div>
            </div>

            <div className="hero-image-wrap">
                <video
                    src="/novaai.mp4"
                    className="hero-main-image"
                    autoPlay
                    loop
                    muted
                    playsInline
                />
            </div>

            {/* Process showcase - 4 step images */}
            <div className="process-showcase">
                <h2 className="process-showcase-title">이렇게 타이핑이 진행됩니다</h2>
                <p className="process-showcase-subtitle">사진을 넣고, AI가 수식을 생성하고, 한글 파일에 자동 타이핑합니다.</p>
                <div className="process-showcase-grid">
                    {processSteps.map((item) => (
                        <div key={item.step} className="process-showcase-item">
                            <div className="process-showcase-head">
                                <div className="process-showcase-step">{item.step}</div>
                                <p className="process-showcase-label">{item.label}</p>
                            </div>
                            <button
                                type="button"
                                className="process-showcase-img-button"
                                onClick={() =>
                                    setSelectedProcessImage({
                                        src: item.image,
                                        alt: item.alt,
                                    })
                                }
                                aria-label={`${item.label} 이미지 확대 보기`}
                            >
                                <img src={item.image} alt={item.alt} className="process-showcase-img" />
                            </button>
                            <p className="process-showcase-desc">{item.description}</p>
                        </div>
                    ))}
                </div>
            </div>
            {selectedProcessImage && (
                <div
                    className="process-lightbox"
                    onClick={() => setSelectedProcessImage(null)}
                    role="dialog"
                    aria-modal="true"
                    aria-label="확대 이미지 보기"
                >
                    <button
                        type="button"
                        className="process-lightbox-close"
                        onClick={() => setSelectedProcessImage(null)}
                        aria-label="확대 보기 닫기"
                    >
                        ×
                    </button>
                    <div
                        className="process-lightbox-content"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <img
                            src={selectedProcessImage.src}
                            alt={selectedProcessImage.alt}
                            className="process-lightbox-img"
                        />
                    </div>
                </div>
            )}
        </section>
    );
}
