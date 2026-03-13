"use client";
import React, { useMemo, useState } from "react";
import examScene1 from "../003.png";
import examScene2 from "../002.png";
import examScene3 from "../001.png";

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
        alt: "완성된 시험지 결과물 예시",
        buttonLabel: "완성 문서",
        title: "완성된 시험지 결과물",
        caption: "완성된 문서를 실제 시험지 결과물처럼 깔끔하게 확인할 수 있습니다.",
    },
    {
        image: examScene2.src,
        alt: "문항 리스트와 코드 생성 예시",
        buttonLabel: "문항 정리",
        title: "문항별 정리와 생성",
        caption: "문항 리스트를 정리하고 생성 과정을 확인하면서 원하는 흐름으로 편집할 수 있습니다.",
    },
    {
        image: examScene3.src,
        alt: "원본 이미지 업로드 예시",
        buttonLabel: "원본 업로드",
        title: "원본 이미지 업로드",
        caption: "문항 이미지를 업로드하면 Nova AI가 결과물 제작을 위한 흐름을 바로 시작합니다.",
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
        caption: "하루 4시간 기준 요금제",
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
