"use client";
import { useState, useEffect } from "react";

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
        <section className="section-cta">
            <div className="section-inner container-narrow text-center">
                <h2 className="benefits-title mb-6">
                    <span className="text-gradient">
                        {typedText}
                    </span>
                    <span className="typing-cursor"></span>
                    가 당신의 한글 문서를
                    <br />
                    완벽하게 처리합니다
                </h2>
                <p className="benefits-subtitle mb-10">
                    수식 입력, 표 작성, 문서 편집까지 모두 Nova AI가 해결해드립니다.
                </p>

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
            </div>
        </section>
    );
}
