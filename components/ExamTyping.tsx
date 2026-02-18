"use client";
import React from "react";

interface ExamItem {
    image: string;
    alt: string;
    caption: string;
}

const items: ExamItem[] = [
    {
        image: "/math1.png",
        alt: "평가원 보기 박스 예시",
        caption: "평가원 스타일의 <보기> 박스가 자동으로 삽입됩니다.",
    },
    {
        image: "/math2.png",
        alt: "평가원 글상자 예시",
        caption: "평가원 스타일 글상자가 자동으로 삽입됩니다.",
    },
    {
        image: "/math3.png",
        alt: "수식 타이핑 예시",
        caption: "완벽한 수식 타이핑 기능을 제공합니다. 사람보다 정확한 수식 타이핑을 작성합니다.",
    },
];

export default function ExamTyping() {
    const [featuredItem, ...secondaryItems] = items;

    return (
        <section id="exam-typing" className="exam-section">
            <div className="exam-inner">
                {/* Header */}
                <div className="exam-header">
                    <h2 className="exam-title">
                        시험지 전용 타이핑 기능을 제공합니다
                    </h2>
                    <p className="exam-subtitle">
                        수능·모의고사 스타일의 보기 박스, 글상자, 조건 박스 등
                        <br />
                        평가원 형식을 그대로 재현하여 한글 문서에 자동으로 삽입합니다.
                    </p>
                </div>

                <div className="exam-showcase">
                    <div className="exam-featured-card">
                        <div className="exam-card-img-wrap exam-card-img-wrap-featured">
                            <img
                                src={featuredItem.image}
                                alt={featuredItem.alt}
                                className="exam-card-img exam-card-img-featured"
                            />
                        </div>
                        <p className="exam-card-caption exam-card-caption-featured">
                            {featuredItem.caption}
                        </p>
                    </div>

                    <div className="exam-grid">
                        {secondaryItems.map((item, idx) => (
                            <div key={idx} className="exam-card">
                                <div className="exam-card-img-wrap">
                                    <img
                                        src={item.image}
                                        alt={item.alt}
                                        className="exam-card-img"
                                    />
                                </div>
                                <p className="exam-card-caption">{item.caption}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </section>
    );
}
