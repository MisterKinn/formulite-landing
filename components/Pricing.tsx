"use client";

import { useRouter } from "next/navigation";

const CheckIcon = () => (
    <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="pricing-check-icon"
    >
        <polyline points="20 6 9 17 4 12" />
    </svg>
);

interface PricingPlan {
    name: string;
    subDescription: string;
    price: string;
    period: string;
    features: string[];
    cta: string;
    popular?: boolean;
}

const plans: PricingPlan[] = [
    {
        name: "무료",
        subDescription: "제한적인 AI 생성과 기본 기능을 제공합니다.",
        price: "0",
        period: "/월",
        features: [
            "하루 10회 AI 생성",
            "기본 수식 자동화",
            "광고 없는 경험",
            "커뮤니티 지원",
            "AI 코드 생성",
        ],
        cta: "무료로 시작하기",
    },
    {
        name: "플러스 요금제",
        subDescription: "전문적인 한글 문서 자동화를 시작해보세요.",
        price: "9,900",
        period: "/월",
        features: [
            "무제한 AI 생성",
            "모든 수식 자동화",
            "코드 저장 & 관리",
            "우선 지원 서비스",
            "AI 최적화 기능",
        ],
        cta: "플러스 시작하기",
        popular: true,
    },
    {
        name: "프로 요금제",
        subDescription: "모든 프리미엄 기능을 사용하세요.",
        price: "29,900",
        period: "/월",
        features: [
            "무제한 모든 기능",
            "팀 협업 기능",
            "API 액세스",
            "전담 지원 서비스",
            "최우선 업데이트",
        ],
        cta: "프로 시작하기",
    },
];

export default function Pricing() {
    const router = useRouter();

    const handlePlanClick = (planName: string, price: string) => {
        if (planName === "무료") {
            // 무료 플랜은 로그인 페이지로 이동
            router.push("/login");
        } else if (planName === "플러스 요금제") {
            // 플러스 플랜으로 결제 페이지 이동 (월간 구독)
            router.push(
                "/payment?amount=9900&orderName=Nova AI 플러스 요금제&recurring=true"
            );
        } else if (planName === "프로 요금제") {
            // 프로 플랜으로 결제 페이지 이동 (월간 구독)
            router.push(
                "/payment?amount=29900&orderName=Nova AI 프로 요금제&recurring=true"
            );
        }
    };

    return (
        <section id="pricing" className="section-base">
            <div className="section-inner">
                <h2 className="features-title">이용요금 안내</h2>
                <p className="features-description">
                    합리적인 가격에 최고의 경험을 제공합니다.
                </p>

                <div className="pricing-grid">
                    {plans.map((plan, index) => (
                        <div
                            key={plan.name}
                            className={`pricing-card-new ${
                                plan.popular ? "pricing-card-popular" : ""
                            }`}
                        >
                            {plan.popular && (
                                <span className="pricing-badge">BEST</span>
                            )}
                            <div className="pricing-card-content">
                                <h3 className="pricing-plan-name">
                                    {plan.name}
                                </h3>

                                <div className="pricing-price-row">
                                    <span className="pricing-price">
                                        {plan.price}
                                    </span>
                                    <span className="pricing-period">
                                        {plan.period}
                                    </span>
                                </div>
                                <p className="pricing-plan-subdesc">
                                    {plan.subDescription}
                                </p>

                                <ul className="pricing-features-list">
                                    {plan.features.map((feature, i) => (
                                        <li
                                            key={i}
                                            className="pricing-feature-item"
                                        >
                                            <CheckIcon />
                                            <span>{feature}</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>

                            <button
                                onClick={() =>
                                    handlePlanClick(plan.name, plan.price)
                                }
                                className={`pricing-cta-btn ${
                                    plan.popular ? "pricing-cta-popular" : ""
                                }`}
                            >
                                {plan.cta}
                            </button>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
}
