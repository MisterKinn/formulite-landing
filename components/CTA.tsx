"use client";
import { useState, useEffect } from "react";
import ctaBackgroundImage from "../macos_hero_startframe__by51tsiyzaj6_large_2x.jpg";

export default function CTA() {
    const [typedText, setTypedText] = useState("");

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
        <section
            className="section-cta"
            style={{
                backgroundImage: `linear-gradient(rgba(0, 0, 0, 0.38), rgba(0, 0, 0, 0.38)), url(${ctaBackgroundImage.src})`,
                backgroundSize: "cover",
                backgroundPosition: "center",
                backgroundRepeat: "no-repeat",
            }}
        >
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
                    <a href="/api/download/windows" style={{ textDecoration: "none" }}>
                        <button className="primary-button">
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
        </section>
    );
}
