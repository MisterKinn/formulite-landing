"use client";
import React from "react";

/* ── Gemini sparkle / star icon ── */
const GeminiIcon = ({ size = 32 }: { size?: number }) => (
    <svg
        width={size}
        height={size}
        viewBox="0 0 28 28"
        fill="none"
    >
        <path
            d="M14 2C14 2 16.2 8.8 19.7 12.3C23.2 15.8 26 14 26 14C26 14 23.2 12.2 19.7 15.7C16.2 19.2 14 26 14 26C14 26 11.8 19.2 8.3 15.7C4.8 12.2 2 14 2 14C2 14 4.8 15.8 8.3 12.3C11.8 8.8 14 2 14 2Z"
            fill="currentColor"
        />
    </svg>
);

/* ── Flow step data ── */
interface FlowStep {
    step: string;
    title: string;
    description: string;
    visual: React.ReactNode;
}

const flowSteps: FlowStep[] = [
    {
        step: "01",
        title: "이미지 입력",
        description: "수식이 포함된 사진, 캡처, 스크린샷을 드래그하여 업로드합니다.",
        visual: (
            <div className="gemini-flow-visual gemini-flow-visual--input">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <path d="M21 15l-5-5L5 21" />
                </svg>
            </div>
        ),
    },
    {
        step: "02",
        title: "Gemini 분석",
        description: "Gemini 3 Pro가 이미지를 멀티모달로 분석하고 수식 구조를 추론합니다.",
        visual: (
            <div className="gemini-flow-visual gemini-flow-visual--analyze">
                <div className="gemini-flow-pulse">
                    <GeminiIcon size={48} />
                </div>
            </div>
        ),
    },
    {
        step: "03",
        title: "코드 생성 & 타이핑",
        description: "인식된 결과를 Python 코드로 변환, 한글 파일에 자동 입력합니다.",
        visual: (
            <div className="gemini-flow-visual gemini-flow-visual--output">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <path d="M14 2v6h6" />
                    <path d="M9 15l2 2 4-4" />
                </svg>
            </div>
        ),
    },
];

export default function GeminiAI() {
    return (
        <section id="gemini-ai" className="gemini-section">
            {/* ── Background decoration ── */}
            <div className="gemini-bg-glow" />

            {/* ── Header ── */}
            <div className="gemini-header">
                <h2 className="gemini-title">
                    Gemini 3 Pro의
                    <br />
                    <span className="gemini-title-gradient">이미지 인식 & 추론 능력</span>
                </h2>
                <p className="gemini-subtitle">
                    Google의 최신 멀티모달 AI 모델 Gemini 3 Pro가
                    <br />
                    사진 속 수식을 정확히 인식하고 논리적으로 추론합니다.
                </p>
            </div>

            {/* ── AI Flow : 3-step visual ── */}
            <div className="gemini-flow">
                <h3 className="gemini-flow-heading">이미지에서 문서까지, 한 번에</h3>
                <div className="gemini-flow-steps">
                    {flowSteps.map((item) => (
                        <div key={item.step} className="gemini-flow-card">
                            <div className="gemini-flow-step-num">{item.step}</div>
                            {item.visual}
                            <h4 className="gemini-flow-card-title">{item.title}</h4>
                            <p className="gemini-flow-card-desc">{item.description}</p>
                        </div>
                    ))}
                </div>
            </div>

            <div className="gemini-download-wrap">
                <a
                    href="/api/download/example-hwp"
                    className="gemini-download-btn"
                >
                    예시 한글 파일 다운로드
                </a>
            </div>

        </section>
    );
}
