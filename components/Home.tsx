"use client";
import React, { useEffect, useRef, useState } from "react";
import processImage1 from "../int1 (2).png";
import processImage2 from "../int2.png";
import processImage3 from "../int3.png";

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
    const [isEventStripVisible, setIsEventStripVisible] = useState(true);
    const [typedText, setTypedText] = useState("");
    const [isProcessShowcaseVisible, setIsProcessShowcaseVisible] = useState(false);
    const [activeProcessIndex, setActiveProcessIndex] = useState(0);
    const [isProcessAutoplaying, setIsProcessAutoplaying] = useState(true);
    const [selectedProcessImage, setSelectedProcessImage] = useState<{
        src: string;
        alt: string;
    } | null>(null);
    const processShowcaseRef = useRef<HTMLDivElement | null>(null);
    const processCarouselRef = useRef<HTMLDivElement | null>(null);
    const eventStripRef = useRef<HTMLDivElement | null>(null);
    const hasInitializedProcessShowcaseRef = useRef(false);
    const fullText = "Nova AI";
    const processSteps = [
        {
            step: "1",
            label: "1. 사진업로드",
            image: processImage1.src,
            alt: "사진 드래그앤드롭",
            description:
                "사진을 드래그 앤 드롭 또는 Ctrl C+V로 넣어주세요.\n여러 개의 이미지 파일이 등록 가능합니다.",
        },
        {
            step: "2",
            label: "2. AI 코드 생성",
            image: processImage2.src,
            alt: "AI 코드 생성 중",
            description:
                "보내기 버튼을 누르면 AI 코드가 생성되며,\n글씨와 수식 폰트를 수정할 수 있습니다.",
        },
        {
            step: "3",
            label: "3. 완성된 문서",
            image: processImage3.src,
            alt: "한글 문서 결과",
            description:
                "완벽한 정확도로 완성된 문서를 확인해보세요.\n이것이 노바AI의 기술력입니다.",
            isHighlightedDescription: true,
        },
    ];

    useEffect(() => {
        if (typeof window === "undefined") return;

        const dismissed = window.localStorage.getItem("home-event-strip-dismissed");
        if (dismissed === "true") {
            setIsEventStripVisible(false);
        }
    }, []);

    useEffect(() => {
        const root = document.documentElement;
        const element = eventStripRef.current;

        if (!isEventStripVisible || !element) {
            root.style.setProperty("--home-event-strip-height", "0px");
            return () => {
                root.style.setProperty("--home-event-strip-height", "0px");
            };
        }

        const updateEventStripHeight = () => {
            root.style.setProperty(
                "--home-event-strip-height",
                `${element.getBoundingClientRect().height}px`,
            );
        };

        updateEventStripHeight();

        const resizeObserver = new ResizeObserver(updateEventStripHeight);
        resizeObserver.observe(element);
        window.addEventListener("resize", updateEventStripHeight);

        return () => {
            resizeObserver.disconnect();
            window.removeEventListener("resize", updateEventStripHeight);
            root.style.setProperty("--home-event-strip-height", "0px");
        };
    }, [isEventStripVisible]);

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

    useEffect(() => {
        const target = processShowcaseRef.current;
        if (!target) return;

        const observer = new IntersectionObserver(
            ([entry]) => {
                setIsProcessShowcaseVisible(entry.isIntersecting);
            },
            {
                threshold: 0.3,
            },
        );

        observer.observe(target);
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        if (!isProcessShowcaseVisible || hasInitializedProcessShowcaseRef.current) return;

        const container = processCarouselRef.current;
        if (!container) return;

        const slides = container.querySelectorAll<HTMLElement>("[data-process-slide]");
        const firstSlide = slides[0];
        if (!firstSlide) return;

        const initialLeft =
            firstSlide.offsetLeft - (container.clientWidth - firstSlide.clientWidth) / 2;

        container.scrollTo({
            left: initialLeft,
            behavior: "auto",
        });
        setActiveProcessIndex(0);
        hasInitializedProcessShowcaseRef.current = true;
    }, [isProcessShowcaseVisible]);

    const handleProcessScroll = () => {
        const container = processCarouselRef.current;
        if (!container) return;

        const slides = Array.from(
            container.querySelectorAll<HTMLElement>("[data-process-slide]"),
        );
        if (!slides.length) return;

        const containerCenter = container.scrollLeft + container.clientWidth / 2;
        let nextActiveIndex = 0;
        let closestDistance = Number.POSITIVE_INFINITY;

        slides.forEach((slide, index) => {
            const slideCenter = slide.offsetLeft + slide.clientWidth / 2;
            const distance = Math.abs(slideCenter - containerCenter);

            if (distance < closestDistance) {
                closestDistance = distance;
                nextActiveIndex = index;
            }
        });

        setActiveProcessIndex(nextActiveIndex);
    };

    const scrollToProcess = (index: number) => {
        const container = processCarouselRef.current;
        if (!container) return;

        const slides = container.querySelectorAll<HTMLElement>("[data-process-slide]");
        const targetSlide = slides[index];
        if (!targetSlide) return;

        const nextLeft =
            targetSlide.offsetLeft - (container.clientWidth - targetSlide.clientWidth) / 2;

        container.scrollTo({
            left: nextLeft,
            behavior: "smooth",
        });
        setActiveProcessIndex(index);
    };

    const handleCloseEventStrip = () => {
        setIsEventStripVisible(false);
        if (typeof window !== "undefined") {
            window.localStorage.setItem("home-event-strip-dismissed", "true");
        }
    };

    useEffect(() => {
        if (!isProcessAutoplaying || !isProcessShowcaseVisible) return;

        const intervalId = window.setInterval(() => {
            const nextIndex = (activeProcessIndex + 1) % processSteps.length;
            scrollToProcess(nextIndex);
        }, 8000);

        return () => window.clearInterval(intervalId);
    }, [activeProcessIndex, isProcessAutoplaying, isProcessShowcaseVisible, processSteps.length]);

    return (
        <section id="home" className="hero">
            <div className="hero-gradient-bg" />
            {isEventStripVisible && (
                <div ref={eventStripRef} className="event-strip">
                    <div className="container">
                        <div className="event-strip__inner">
                            <div className="event-strip__content">
                                <p className="event-strip__text">
                                    오픈 특가 이벤트, 연간 결제 30% 할인 이벤트
                                </p>
                                <a href="#pricing" className="event-strip__link">
                                    더 알아보기
                                    <ArrowRightIcon />
                                </a>
                            </div>
                            <button
                                type="button"
                                className="event-strip__close"
                                onClick={handleCloseEventStrip}
                                aria-label="이벤트 배너 닫기"
                            >
                                ×
                            </button>
                        </div>
                    </div>
                </div>
            )}
            <div className="hero-intro">
                <div className="hero-stars" aria-hidden="true">
                    <div className="hero-star hero-star--1" />
                    <div className="hero-star hero-star--2" />
                    <div className="hero-star hero-star--3" />
                    <div className="hero-star hero-star--4" />
                    <div className="hero-star hero-star--5" />
                    <div className="hero-star hero-star--6" />
                    <div className="hero-star hero-star--7" />
                    <div className="hero-star hero-star--8" />
                    <div className="hero-star hero-star--9" />
                    <div className="hero-star hero-star--10" />
                    <div className="hero-star hero-star--11" />
                    <div className="hero-star hero-star--12" />
                </div>
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
                        <p className="subtitle hero-subtitle-emphasis">
                            더 이상 내신 기출문제집 타이핑에 시간쓰지 마세요.
                            <br />
                            Nova AI가 압도적인 타이핑을 보여드리겠습니다.
                        </p>

                        <div className="hero-actions">
                            <a
                                href="https://storage.googleapis.com/physics2/NovaAI_Setup_2.0.0.exe"
                                download
                                style={{ textDecoration: "none" }}
                            >
                                <button className="primary-button hero-download-button">
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
                            </a>
                        </div>
                    </div>
                </div>
            </div>

            {/* Process showcase - 4 step images */}
            <div ref={processShowcaseRef} className="process-showcase">
                <div className="process-showcase-shell">
                    <h2 className="process-showcase-title">노바AI 기능 소개</h2>
                    <p className="process-showcase-subtitle">
                        독보적인 OCR 인식 성능과 이미지 크롭·삽입 자동화, 그리고 자연어로 바로 수정할 수 있는 채팅 편집 기능까지 한 번에 경험해보세요.
                    </p>
                    <div
                        ref={processCarouselRef}
                        className="process-showcase-carousel"
                        onScroll={handleProcessScroll}
                    >
                        {processSteps.map((item, index) => (
                            <article
                                key={item.step}
                                className={`process-showcase-item ${
                                    isProcessShowcaseVisible
                                        ? "process-showcase-item--visible"
                                        : ""
                                } ${
                                    activeProcessIndex === index
                                        ? "process-showcase-item--active"
                                        : ""
                                }`}
                                style={{
                                    animationDelay: `${index * 180}ms`,
                                }}
                                data-process-slide
                            >
                                <div className="process-showcase-card">
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
                                </div>
                            </article>
                        ))}
                    </div>
                    <div className="process-showcase-controls">
                        <div className="process-showcase-dots" aria-label="진행 단계 선택">
                            {processSteps.map((item, index) => (
                                <button
                                    key={item.step}
                                    type="button"
                                    className={`process-showcase-dot ${
                                        activeProcessIndex === index
                                            ? "process-showcase-dot--active"
                                            : ""
                                    }`}
                                    onClick={() => scrollToProcess(index)}
                                    aria-label={`${item.label} 보기`}
                                    aria-pressed={activeProcessIndex === index}
                                />
                            ))}
                        </div>
                        <button
                            type="button"
                            className="process-showcase-autoplay"
                            onClick={() => setIsProcessAutoplaying((prev) => !prev)}
                            aria-label={
                                isProcessAutoplaying
                                    ? "자동 회전 일시정지"
                                    : "자동 회전 시작"
                            }
                            aria-pressed={isProcessAutoplaying}
                        >
                            {isProcessAutoplaying ? (
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                                    <rect x="6" y="5" width="4" height="14" rx="1.5" fill="currentColor" />
                                    <rect x="14" y="5" width="4" height="14" rx="1.5" fill="currentColor" />
                                </svg>
                            ) : (
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                                    <path
                                        d="M8 6.5c0-1.2.97-1.94 2.01-1.37l8.23 4.5c1.05.57 1.05 2.08 0 2.65l-8.23 4.5C8.97 17.35 8 16.61 8 15.4V6.5z"
                                        fill="currentColor"
                                    />
                                </svg>
                            )}
                        </button>
                    </div>
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
