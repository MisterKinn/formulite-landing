"use client";
import React from "react";

interface BenefitCard {
    number: string;
    icon: React.ReactNode;
    title: string;
    description: string;
}

const CodeIcon = () => (
    <svg
        width="28"
        height="28"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
    >
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <path d="M14 17h7" />
        <path d="M17.5 14v7" />
    </svg>
);

const ChartIcon = () => (
    <svg
        width="28"
        height="28"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
    >
        <path d="M3 17l6-6 4 4 8-8" />
        <path d="M17 7h4v4" />
    </svg>
);

const FolderIcon = () => (
    <svg
        width="28"
        height="28"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
    >
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
);

const SparkleIcon = () => (
    <svg
        width="28"
        height="28"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
    >
        <path d="M12 3v1m0 16v1m-8-9H3m18 0h-1m-2.636-6.364l-.707.707M6.343 17.657l-.707.707m12.728 0l-.707-.707M6.343 6.343l-.707-.707" />
        <circle cx="12" cy="12" r="4" />
    </svg>
);

const benefitCards: BenefitCard[] = [
    {
        number: "01",
        icon: <CodeIcon />,
        title: "자연어로 자동화",
        description:
            "한글 문장을 입력하면 Nova AI가 Python 코드를 만들고 한글 파일을 자동으로 수정합니다.",
    },
    {
        number: "02",
        icon: <ChartIcon />,
        title: "생산성 향상",
        description:
            "복잡한 수식 입력과 반복 작업 시간을 획기적으로 단축하여 업무 효율을 극대화합니다.",
    },
    {
        number: "03",
        icon: <FolderIcon />,
        title: "코드 저장 & 재사용",
        description:
            "자주 사용하는 코드를 Python 파일로 저장해 언제든지 불러와서 재사용할 수 있습니다.",
    },
    {
        number: "04",
        icon: <SparkleIcon />,
        title: "안전한 데이터 보호",
        description:
            "모든 데이터는 암호화 통신으로 전송되며, 서버에 저장되지 않고 즉시 삭제됩니다.",
    },
];

export default function Benefits() {
    return (
        <section id="benefits" className="section-wide">
            <div className="section-inner">
                <div className="benefits-layout">
                    {/* Left side - Text content */}
                    <div className="benefits-text-content">
                        <h2 className="benefits-main-title">
                            한글 문서 작성의
                            <br />
                            미래를 경험해보세요
                        </h2>
                        <p className="benefits-main-desc">
                            복잡한 수식과 반복 작업을 AI에게 맡기고
                            <br />
                            창의적인 작업에 집중하세요.
                        </p>
                    </div>

                    {/* Right side - 2x2 Card grid */}
                    <div className="benefits-card-grid">
                        {benefitCards.map((card, index) => (
                            <div
                                key={card.number}
                                className="benefit-card-item"
                            >
                                <div className="benefit-card-header">
                                    <div className="benefit-card-icon">
                                        {card.icon}
                                    </div>
                                    <span className="benefit-card-number">
                                        {card.number}
                                    </span>
                                </div>
                                <h3 className="benefit-card-title-new">
                                    {card.title}
                                </h3>
                                <p className="benefit-card-desc-new">
                                    {card.description}
                                </p>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </section>
    );
}
