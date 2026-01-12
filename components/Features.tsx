"use client";
import React, { ReactNode } from "react";

interface Feature {
    title: string;
    description: string;
    icon: ReactNode;
}

const AIIcon = () => (
    <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
    >
        <rect x="4" y="4" width="16" height="16" rx="2" />
        <path d="M9 9h.01" />
        <path d="M15 9h.01" />
        <path d="M9 15h.01" />
        <path d="M15 15h.01" />
    </svg>
);

const SigmaIcon = () => (
    <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
    >
        <path d="M18 6H6l6 6-6 6h12" />
    </svg>
);

const LightningIcon = () => (
    <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
    >
        <path d="M13 3L5 14h6l-1 7 8-11h-6l1-7z" />
    </svg>
);

const CodeIcon = () => (
    <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
    >
        <path d="M16 18l6-6-6-6" />
        <path d="M8 6l-6 6 6 6" />
    </svg>
);

const DocumentIcon = () => (
    <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
    >
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <path d="M14 2v6h6" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
    </svg>
);

const SyncIcon = () => (
    <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
    >
        <path d="M21.5 2v6h-6" />
        <path d="M2.5 22v-6h6" />
        <path d="M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2" />
    </svg>
);

const features: Feature[] = [
    {
        title: "AI 기반 생성",
        description:
            "필요한 내용을 자연어로 설명하면 AI가 정확한 Python 코드를 생성합니다.",
        icon: <AIIcon />,
    },
    {
        title: "수식 생성",
        description:
            "AI 코드 생성을 통해 복잡한 수학 수식을 손쉽게 만들 수 있습니다.",
        icon: <SigmaIcon />,
    },
    {
        title: "즉시 자동화",
        description:
            "생성된 코드를 실행하면 한글 파일이 실시간으로 빠르게 업데이트됩니다.",
        icon: <LightningIcon />,
    },
    {
        title: "코드 관리",
        description:
            "자주 사용하는 코드를 저장하고 언제든지 불러와서 재사용할 수 있습니다.",
        icon: <CodeIcon />,
    },
    {
        title: "문서 호환성",
        description:
            "다양한 한글 문서 형식을 지원하며 기존 문서와 완벽하게 호환됩니다.",
        icon: <DocumentIcon />,
    },
    {
        title: "실시간 동기화",
        description:
            "변경 사항이 즉시 반영되어 작업 효율을 극대화할 수 있습니다.",
        icon: <SyncIcon />,
    },
];

export default function Features() {
    return (
        <section id="features" className="section-base">
            <div className="section-inner">
                <h2 className="features-title">
                    문서 자동화를 위한 강력한 기능
                </h2>
                <p className="features-description">
                    AI 기반 코드 생성으로 HWP 문서 편집을
                    <br />
                    자동화하는 데 필요한 모든 것을 제공합니다.
                </p>

                <div className="features-grid">
                    {features.map((feature, index) => (
                        <div key={index} className="feature-card">
                            <div className="feature-icon-circle">
                                {feature.icon}
                            </div>
                            <h3 className="feature-item-title">
                                {feature.title}
                            </h3>
                            <p className="feature-item-desc">
                                {feature.description}
                            </p>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
}
