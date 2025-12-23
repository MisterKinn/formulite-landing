import React from "react";
import "./pricing.css";

export default function Pricing() {
    return (
        <section className="pricing-section">
            <div className="pricing-header">
                <h1 className="pricing-title">요금제 안내</h1>
                <p className="pricing-desc">
                    FormuLite는 다양한 요금제를 통해 모든 사용자가 합리적으로
                    서비스를 이용할 수 있도록 설계되었습니다.
                    <br />
                    아래에서 원하는 플랜을 선택해보세요.
                </p>
            </div>
            <div className="pricing-cards">
                {/* Free Plan */}
                <div className="pricing-card">
                    <h2 className="plan-title">무료</h2>
                    <div className="plan-price">₩ 0</div>
                    <ul className="plan-features">
                        <li>하루 10회 AI 생성 사용 가능</li>
                        <li>수식 자동화 기능 사용 가능</li>
                        <li>광고 없는 쾌적한 경험</li>
                        <li>지원 서비스 제공</li>
                    </ul>
                    <button className="plan-cta">무료로 시작하기</button>
                </div>
                {/* Plus Plan */}
                <div className="pricing-card popular">
                    <div className="badge">인기</div>
                    <h2 className="plan-title">플러스</h2>
                    <div className="plan-price">
                        ₩ 9,900 <span className="plan-cycle">/월</span>
                    </div>
                    <ul className="plan-features">
                        <li>AI 최적화 기능 제공</li>
                        <li>모든 수식 자동화 기능 제공</li>
                        <li>여러 프리미엄 기능 제공</li>
                        <li>우선 지원 서비스 제공</li>
                    </ul>
                    <button className="plan-cta popular-cta">
                        플러스로 시작하기
                    </button>
                    <div className="plan-note">연간 결제 시 20% 할인</div>
                </div>
                {/* Pro Plan */}
                <div className="pricing-card">
                    <h2 className="plan-title">프로</h2>
                    <div className="plan-price">
                        ₩ 29,900 <span className="plan-cycle">/월</span>
                    </div>
                    <ul className="plan-features">
                        <li>무제한 AI 생성 및 최적화 기능 제공</li>
                        <li>모든 프리미엄 서비스 이용 가능</li>
                        <li>가장 빠른 업데이트 적용</li>
                        <li>전담 지원 서비스 및 최우선 응답</li>
                    </ul>
                    <button className="plan-cta">프로로 시작하기</button>
                    <div className="plan-note">연간 결제 시 20% 할인</div>
                </div>
            </div>
        </section>
    );
}
