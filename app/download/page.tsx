"use client";

import React, { useEffect, useRef, useState } from "react";
import { Navbar } from "../../components/Navbar";

import "../style.css";
import "../mobile.css";
import "./download.css";

import Image from "next/image";

export default function DownloadContent() {
    const [hoveredPlatform, setHoveredPlatform] = useState<string | null>(null);
    const [activeSlide, setActiveSlide] = useState(0);
    const [isDragging, setIsDragging] = useState(false);
    const viewportRef = useRef<HTMLDivElement | null>(null);
    const isMouseDownRef = useRef(false);
    const dragStartXRef = useRef(0);
    const dragStartScrollLeftRef = useRef(0);
    const hasDraggedRef = useRef(false);

    const setupSteps = [
        { img: "/setup11.png", step: 1 },
        { img: "/setup12.png", step: 2 },
        { img: "/setup13.png", step: 3 },
        { img: "/setup14.png", step: 4 },
        { img: "/setup15.png", step: 5 },
    ];

    const platforms = [
        {
            name: "Windows",
            img: "/windows.png",
            link: "/api/download/windows",
            desc: "Windows 10 이상",
            size: "104 MB",
        },
    ];

    useEffect(() => {
        void fetch("/api/analytics/visit", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ page: "/download" }),
        }).catch(() => {});
    }, []);

    const getSlideStep = (viewport: HTMLDivElement) => {
        const slide = viewport.querySelector(
            ".download-guide-slide",
        ) as HTMLElement | null;
        if (!slide) return 0;
        return slide.offsetWidth + 16;
    };

    const getNearestSlideIndex = (viewport: HTMLDivElement) => {
        const step = getSlideStep(viewport);
        if (step === 0) return 0;
        const raw = viewport.scrollLeft / step;
        return Math.max(
            0,
            Math.min(setupSteps.length - 1, Math.round(raw)),
        );
    };

    const scrollToSlide = (index: number) => {
        const viewport = viewportRef.current;
        if (!viewport) return;
        const step = getSlideStep(viewport);
        const maxScroll = viewport.scrollWidth - viewport.clientWidth;
        const target = Math.min(index * step, maxScroll);
        viewport.scrollTo({ left: target, behavior: "smooth" });
        setActiveSlide(index);
    };

    const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
        const viewport = viewportRef.current;
        if (!viewport) return;

        isMouseDownRef.current = true;
        hasDraggedRef.current = false;
        setIsDragging(true);
        dragStartXRef.current = e.clientX;
        dragStartScrollLeftRef.current = viewport.scrollLeft;

        viewport.style.scrollBehavior = "auto";
    };

    const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
        if (!isMouseDownRef.current) return;
        const viewport = viewportRef.current;
        if (!viewport) return;

        const dx = e.clientX - dragStartXRef.current;
        if (Math.abs(dx) > 4) hasDraggedRef.current = true;
        viewport.scrollLeft = dragStartScrollLeftRef.current - dx;
    };

    const endDrag = () => {
        if (!isMouseDownRef.current) return;
        isMouseDownRef.current = false;
        setIsDragging(false);

        const viewport = viewportRef.current;
        if (!viewport) return;

        viewport.style.scrollBehavior = "smooth";

        const nearest = getNearestSlideIndex(viewport);
        scrollToSlide(nearest);
    };

    const handleScroll = () => {
        if (isMouseDownRef.current) return;
        const viewport = viewportRef.current;
        if (!viewport) return;
        setActiveSlide(getNearestSlideIndex(viewport));
    };

    return (
        <div className="download-page">
            <Navbar />

            <main className="download-main">
                {/* Hero */}
                <section className="download-hero">
                    <div className="download-hero-badge">무료 다운로드</div>
                    <h1 className="download-hero-title">Nova AI 다운로드</h1>
                    <p className="download-hero-desc">
                        AI 기반 문서 자동화의 새로운 경험을 만나보세요.
                    </p>
                </section>

                {/* Platform Cards */}
                <section
                    className={`download-platforms ${
                        platforms.length === 1 ? "single-platform" : ""
                    }`}
                >
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
                                        width="40"
                                        height="40"
                                        viewBox="0 0 24 24"
                                        fill="#3b82f6"
                                    >
                                        <path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-12.9-1.801" />
                                    </svg>
                                ) : (
                                    <svg
                                        width="40"
                                        height="48"
                                        viewBox="0 0 24 24"
                                        fill="#ededed"
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
                                    className="download-card-button"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        void fetch("/api/analytics/download", {
                                            method: "POST",
                                            headers: {
                                                "Content-Type":
                                                    "application/json",
                                            },
                                            body: JSON.stringify({
                                                platform: p.name.toLowerCase(),
                                            }),
                                        }).catch(() => {});
                                    }}
                                    aria-label={`${p.name} 다운로드`}
                                >
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
                                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                        <polyline points="7 10 12 15 17 10" />
                                        <line x1="12" y1="15" x2="12" y2="3" />
                                    </svg>
                                    다운로드
                                </a>
                            </div>
                        </div>
                    ))}
                </section>

                {/* Installation Guide */}
                <section className="download-guide">
                    <h2 className="download-guide-title">설치 방법</h2>
                    <div className="download-guide-carousel">
                        <div
                            ref={viewportRef}
                            className={`download-guide-viewport ${
                                isDragging ? "is-dragging" : ""
                            }`}
                            onMouseDown={handleMouseDown}
                            onMouseMove={handleMouseMove}
                            onMouseUp={endDrag}
                            onMouseLeave={endDrag}
                            onScroll={handleScroll}
                        >
                            <div className="download-guide-track">
                                {setupSteps.map((item) => (
                                    <div key={item.step} className="download-guide-slide">
                                        <div className="download-guide-image-wrapper">
                                            <span className="download-guide-image-label">
                                                {`Step ${item.step}`}
                                            </span>
                                            <Image
                                                src={item.img}
                                                alt={`설치 방법 ${item.step}단계`}
                                                width={600}
                                                height={600}
                                                className="download-guide-image"
                                            />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    <div className="download-guide-dots">
                        {setupSteps.slice(0, -1).map((item, index) => (
                            <button
                                key={item.step}
                                className={`download-guide-dot ${activeSlide === index ? "active" : ""}`}
                                onClick={() => scrollToSlide(index)}
                                aria-label={`${index + 1}번 이미지로 이동`}
                            />
                        ))}
                    </div>
                </section>

            </main>
        </div>
    );
}
