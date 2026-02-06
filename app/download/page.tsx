"use client";

import React, { useEffect, useState } from "react";
import AOS from "aos";
import "aos/dist/aos.css";
import { Navbar } from "../../components/Navbar";
import Footer from "../../components/Footer";
import Sidebar from "../../components/Sidebar";

import "../style.css";
import "../mobile.css";
import "./download.css";

import Image from "next/image";

export default function DownloadContent() {
    const [hoveredPlatform, setHoveredPlatform] = useState<string | null>(null);

    // GitHub Releases - Update version tag (v1.0.0) when releasing new versions
    const GITHUB_RELEASE_BASE =
        "https://github.com/MisterKinn/formulite-landing/releases/download/v1.0.0";

    const platforms = [
        {
            name: "Windows",
            img: "/windows.png",
            link: `${GITHUB_RELEASE_BASE}/nova-ai-setup-windows.exe`,
            liteLink: `${GITHUB_RELEASE_BASE}/nova-ai-lite-setup-windows.exe`,
            desc: "Windows 10 이상",
            size: "104 MB",
        },
        {
            name: "Mac",
            img: "/apple.png",
            link: `${GITHUB_RELEASE_BASE}/nova-ai-setup-mac.dmg`,
            desc: "macOS 11 이상",
            size: "253 MB",
        },
    ];

    useEffect(() => {
        AOS.init({
            duration: 800,
            easing: "ease-out-cubic",
            offset: 60,
            once: false,
        });
    }, []);

    return (
        <div className="download-page">
            <Navbar />
            <div className="mobile-sidebar-container">
                <Sidebar />
            </div>

            <main className="download-main">
                {/* Hero Section */}
                <section className="download-hero" data-aos="fade-in">
                    <div className="download-hero-badge">무료 다운로드</div>
                    <h1 className="download-hero-title">
                        Nova AI를
                        <br />
                        <span className="download-hero-highlight">
                            지금 시작하세요
                        </span>
                    </h1>
                    <p className="download-hero-desc">
                        AI 기반 문서 자동화의 새로운 경험을 만나보세요.
                        <br />
                        설치는 1분, 생산성은 무한대.
                    </p>
                </section>

                {/* Platform Cards */}
                <section className="download-platforms" data-aos="fade-in">
                    {platforms.map((p) => (
                        <div
                            key={p.name}
                            className={`download-card ${
                                hoveredPlatform === p.name ? "hovered" : ""
                            }`}
                            onMouseEnter={() => setHoveredPlatform(p.name)}
                            onMouseLeave={() => setHoveredPlatform(null)}
                        >
                            <div className="download-card-icon">
                                {p.name === "Windows" ? (
                                    <svg
                                        width="72"
                                        height="72"
                                        viewBox="0 0 24 24"
                                        fill="#0078D4"
                                    >
                                        <path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-12.9-1.801" />
                                    </svg>
                                ) : (
                                    <svg
                                        width="72"
                                        height="88"
                                        viewBox="0 0 24 24"
                                        fill="#fff"
                                    >
                                        <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
                                    </svg>
                                )}
                            </div>
                            <div className="download-card-content">
                                <h3 className="download-card-title">
                                    {p.name}
                                </h3>
                                <p className="download-card-desc">{p.desc}</p>
                                <span className="download-card-size">
                                    {p.size}
                                </span>
                            </div>
                            <div className="download-card-actions">
                                <a
                                    href={p.link}
                                    download
                                    className="download-card-button"
                                    onClick={(e) => e.stopPropagation()}
                                    aria-label={`${p.name} 다운로드`}
                                >
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
                                </a>
                                {p.name === "Windows" && p.liteLink && (
                                    <a
                                        href={p.liteLink}
                                        download
                                        className="download-card-button download-card-button--lite"
                                        onClick={(e) => e.stopPropagation()}
                                        aria-label="Windows Lite 다운로드"
                                    >
                                        Lite
                                    </a>
                                )}
                            </div>
                        </div>
                    ))}
                </section>

                {/* Installation Steps */}
                <section className="download-steps" data-aos="fade-up">
                    <h2 className="download-steps-title">간단한 3단계 설치</h2>
                    <div className="download-steps-grid">
                        <div className="download-step">
                            <div className="download-step-number">1</div>
                            <h3 className="download-step-title">다운로드</h3>
                            <p className="download-step-desc">
                                운영체제에 맞는 설치 파일을
                                <br />
                                다운로드하세요.
                            </p>
                        </div>
                        <div className="download-step">
                            <div className="download-step-number">2</div>
                            <h3 className="download-step-title">설치</h3>
                            <p className="download-step-desc">
                                다운로드한 파일을 실행하고
                                <br />
                                안내를 따르세요.
                            </p>
                        </div>
                        <div className="download-step">
                            <div className="download-step-number">3</div>
                            <h3 className="download-step-title">시작</h3>
                            <p className="download-step-desc">
                                Nova AI를 실행하고
                                <br />
                                마법같은 문서 자동화를 경험하세요.
                            </p>
                        </div>
                    </div>
                </section>

                {/* Requirements */}
                <section className="download-requirements" data-aos="fade-up">
                    <h2 className="download-requirements-title">
                        시스템 요구사항
                    </h2>
                    <div className="download-requirements-grid">
                        <div className="download-requirement-item">
                            <span className="download-requirement-label">
                                운영체제
                            </span>
                            <span className="download-requirement-value">
                                Windows 10+, macOS 11+
                            </span>
                        </div>
                        <div className="download-requirement-item">
                            <span className="download-requirement-label">
                                메모리
                            </span>
                            <span className="download-requirement-value">
                                4GB RAM 이상
                            </span>
                        </div>
                        <div className="download-requirement-item">
                            <span className="download-requirement-label">
                                저장공간
                            </span>
                            <span className="download-requirement-value">
                                500MB 이상
                            </span>
                        </div>
                        <div className="download-requirement-item">
                            <span className="download-requirement-label">
                                인터넷
                            </span>
                            <span className="download-requirement-value">
                                AI 기능 사용 시 필요
                            </span>
                        </div>
                    </div>
                </section>
            </main>

            <Footer />
        </div>
    );
}
