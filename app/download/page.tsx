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

    const platforms = [
        {
            name: "Windows",
            img: "/windows.png",
            link: "/downloads/novaai-win.exe",
            desc: "Windows 10 이상",
            size: "125 MB",
        },
        {
            name: "Mac",
            img: "/apple.png",
            link: "/downloads/novaai-mac.dmg",
            desc: "macOS 11 이상",
            size: "142 MB",
        },
        {
            name: "Linux",
            img: "/linux.png",
            link: "/downloads/novaai-linux.AppImage",
            desc: "Ubuntu 20.04+",
            size: "138 MB",
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
                        <a
                            key={p.name}
                            href={p.link}
                            download
                            className={`download-card ${
                                hoveredPlatform === p.name ? "hovered" : ""
                            }`}
                            onMouseEnter={() => setHoveredPlatform(p.name)}
                            onMouseLeave={() => setHoveredPlatform(null)}
                        >
                            <div className="download-card-icon">
                                <Image
                                    src={p.img}
                                    alt={p.name}
                                    width={64}
                                    height={p.name === "Mac" ? 76 : 64}
                                />
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
                            <div className="download-card-arrow">
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
                                    <path d="M12 5v14M19 12l-7 7-7-7" />
                                </svg>
                            </div>
                        </a>
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
                                Windows 10+, macOS 11+, Linux
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
