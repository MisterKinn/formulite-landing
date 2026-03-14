"use client";
import React from "react";
import nanobananaIllustrationImage from "../251126미.png";

export default function GeminiAI() {
    return (
        <section id="gemini-ai" className="gemini-section">
            {/* ── Background decoration ── */}
            <div className="gemini-bg-glow" />

            <div className="gemini-split-showcase">
                <div className="gemini-performance-panel">
                    <div className="gemini-header">
                        <div className="gemini-badge">노바AI 성능</div>
                        <h2 className="gemini-title">
                            <span className="gemini-title-gradient">Gemini 3.1 Pro를 사용합니다</span>
                            <br />
                            <span>전문 작업을 위해 설계된 모델</span>
                        </h2>
                        <p className="gemini-subtitle">
                            Google의 최신 멀티모달 AI 모델 Gemini 3.1 Pro가
                            <br />
                            사진 속 수식을 정확히 인식하고 논리적으로 추론합니다.
                        </p>
                    </div>
                    <div className="gemini-chart-wrap">
                    <img
                        src="/gemini3.1pro.jpg"
                        alt="Gemini 3.1 Pro 벤치마크 차트"
                        className="gemini-chart-image"
                    />
                    </div>
                </div>
                <div className="gemini-illustration-panel">
                    <div className="gemini-illustration-badge">이미지 생성</div>
                    <h3 className="gemini-illustration-title">
                        <span className="gemini-title-gradient">Nanobanana-pro를 사용합니다</span>
                        <br />
                        <span>가장 완벽한 일러스트 생성</span>
                    </h3>
                    <p className="gemini-illustration-subtitle">
                        Google의 이미지 생성 AI 모델 Nanobanana가
                        <br />
                        최대한 동일한 평가원 이미지를 생성합니다.
                    </p>
                    <div className="gemini-illustration-image-wrap">
                        <img
                            src={nanobananaIllustrationImage.src}
                            alt="반전 효과가 적용된 평가원 스타일 이미지 예시"
                            className="gemini-illustration-image"
                        />
                    </div>
                </div>
            </div>
        </section>
    );
}
