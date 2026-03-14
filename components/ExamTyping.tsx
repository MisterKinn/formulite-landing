"use client";
import React, { useMemo, useState } from "react";
import examScene1 from "../un1.png";
import examScene2 from "../un2.png";
import examScene3 from "../un3.png";
import examScene4 from "../int4.png";
import examScene5 from "../int5.png";
import examScene6 from "../int6.png";

interface ExamItem {
    image: string;
    alt: string;
    buttonLabel: string;
    title: string;
    caption: string;
}

interface HighlightStat {
    eyebrow: string;
    value: string;
    unit: string;
    caption: string;
}

const items: ExamItem[] = [
    {
        image: examScene1.src,
        alt: "완벽한 수식 타이핑 결과 예시",
        buttonLabel: "완벽한 수식 타이핑",
        title: "완벽한 수식 타이핑",
        caption: "볼드체, 선적분, 삼중적분, 행렬 등 다양한 수식 기능을 제공합니다.",
    },
    {
        image: examScene2.src,
        alt: "보기 호출 및 이미지 삽입 예시",
        buttonLabel: "<보기> 호출",
        title: "<보기> 호출 및 삽입",
        caption: "보기 박스와 이미지를 정확한 위치에 삽입합니다.",
    },
    {
        image: examScene3.src,
        alt: "AI 해설 작성 예시",
        buttonLabel: "AI 해설 작성",
        title: "AI 해설 작성",
        caption: "풀이 과정을 자연스럽게 정리해 해설을 작성합니다.",
    },
    {
        image: examScene4.src,
        alt: "표 생성 기능 예시",
        buttonLabel: "표 생성 기능",
        title: "표 생성 기능",
        caption: "수정 없이 결과물을 만들고 표 합치기까지 자동으로 진행합니다.",
    },
    {
        image: examScene5.src,
        alt: "진하게와 밑줄 효과 예시",
        buttonLabel: "진하게+밑줄",
        title: "진하게+밑줄 효과",
        caption: "강조가 필요한 문장에 진하게와 밑줄 효과를 자연스럽게 적용합니다.",
    },
    {
        image: examScene6.src,
        alt: "한자 타이핑 예시",
        buttonLabel: "한자 타이핑",
        title: "한자 타이핑",
        caption: "한자가 포함된 긴 지문도 자연스럽고 정확하게 타이핑합니다.",
    },
];

const highlightStats: HighlightStat[] = [
    {
        eyebrow: "최대 처리량",
        value: "200",
        unit: "문제+",
        caption: "1시간 기준 자동 타이핑",
    },
    {
        eyebrow: "문항당 평균",
        value: "10",
        unit: "초",
        caption: "복잡한 수식도 빠르게 처리",
    },
    {
        eyebrow: "월 운영 비용",
        value: "29,900",
        unit: "원",
        caption: "월 330문제 기준 요금제",
    },
    {
        eyebrow: "작업 가능 시간",
        value: "24",
        unit: "시간",
        caption: "주말과 야간에도 즉시 가능",
    },
];

export default function ExamTyping() {
    const [activeIndex, setActiveIndex] = useState<number | null>(null);
    const currentIndex = activeIndex ?? 0;
    const activeItem = useMemo(() => items[currentIndex], [currentIndex]);
    const handleSceneChange = (nextIndex: number) => {
        const normalizedIndex = (nextIndex + items.length) % items.length;
        setActiveIndex(normalizedIndex);
    };

    return (
        <section id="exam-typing" className="exam-section">
            <div className="exam-inner">
                <div className="exam-header">
                    <h2 className="exam-title">완벽한 시험지 결과물을 만듭니다.</h2>
                    <p className="exam-subtitle">
                        수능·모의고사 스타일의 보기 박스, 글상자, 조건 박스 등
                        <br />
                        평가원 형식을 그대로 재현하여 한글 문서에 자동으로 삽입합니다.
                    </p>
                </div>

                <div className="exam-showcase-panel">
                    <div className="exam-stage">
                        <div className="exam-stage-visual" key={`${currentIndex}-${activeItem.image}`}>
                            <img
                                src={activeItem.image}
                                alt={activeItem.alt}
                                className="exam-stage-image"
                            />
                        </div>
                        <div className="exam-scene-overlay">
                            <div className="exam-scene-controls">
                                <div className="exam-scene-stack">
                                    <div className="exam-scene-switcher" aria-label="시험지 결과물 장면 선택">
                                        {items.map((item, index) => (
                                            <button
                                                key={item.buttonLabel}
                                                type="button"
                                                className={`exam-scene-button ${
                                                    activeIndex === index ? "exam-scene-button--active" : ""
                                                }`}
                                                onClick={() => handleSceneChange(index)}
                                                aria-pressed={activeIndex === index}
                                            >
                                                <span className="exam-scene-button-text">
                                                    {item.buttonLabel}
                                                </span>
                                                {activeIndex === index && (
                                                    <span className="exam-scene-button-detail">
                                                        <span className="exam-scene-button-detail-title">
                                                            {item.title}
                                                        </span>
                                                        <span className="exam-scene-button-detail-caption">
                                                            {item.caption}
                                                        </span>
                                                    </span>
                                                )}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="cc-highlight-grid exam-highlight-grid" aria-label="Nova AI 핵심 성능 지표">
                    {highlightStats.map((stat) => (
                        <article key={stat.eyebrow} className="cc-highlight-card">
                            <p className="cc-highlight-eyebrow">{stat.eyebrow}</p>
                            <p className="cc-highlight-value">
                                <span>{stat.value}</span>
                                <strong>{stat.unit}</strong>
                            </p>
                            <p className="cc-highlight-caption">{stat.caption}</p>
                        </article>
                    ))}
                </div>
            </div>
        </section>
    );
}
