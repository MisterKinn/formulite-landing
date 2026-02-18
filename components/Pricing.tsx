"use client";

import { MouseEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { loadTossPayments } from "@tosspayments/tosspayments-sdk";

const CheckIcon = ({ color = "currentColor" }: { color?: string }) => (
    <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke={color}
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
    prices: {
        monthly: string;
        yearly: string;
    };
    features: string[];
    cta: string;
    popular?: boolean;
    tier: "free" | "go" | "plus" | "pro";
}

type BillingCycle = "monthly" | "yearly";

const plans: PricingPlan[] = [
    {
        name: "Free",
        subDescription: "제한적인 AI 생성과 기본 기능을 제공합니다.",
        prices: {
            monthly: "0",
            yearly: "0",
        },
        features: [
            "총 5회 AI 타이핑 생성",
            "기본 수식 자동화",
            "광고 없는 경험",
            "커뮤니티 지원",
            "AI 코드 생성",
            "복수 계정 작업 불가능",
        ],
        cta: "무료로 시작하기",
        tier: "free",
    },
    {
        name: "Go 요금제",
        subDescription: "핵심 기능을 합리적인 가격으로 시작하세요.",
        prices: {
            monthly: "11,900",
            yearly: "8,330",
        },
        features: [
            "월 132회 AI 타이핑 생성",
            "고급 AI 모델",
            "기본 협업 기능",
            "이메일 지원",
            "복수 계정 작업 불가능",
            "월 1회 1:1 컨설팅 미제공",
        ],
        cta: "Go 시작하기",
        tier: "go",
    },
    {
        name: "Plus 요금제",
        subDescription: "더 많은 기능과 우선 지원을 받으세요.",
        prices: {
            monthly: "29,900",
            yearly: "20,930",
        },
        features: [
            "월 300회+30회 AI 타이핑 생성",
            "고급 AI 모델",
            "팀 공유 기능",
            "우선 지원 서비스",
            "월 1회 1:1 컨설팅",
            "복수 계정 작업 불가능",
        ],
        cta: "Plus 시작하기",
        popular: true,
        tier: "plus",
    },
    {
        name: "Ultra 요금제",
        subDescription: "멀티 로그인이 가능합니다",
        prices: {
            monthly: "99,000",
            yearly: "69,300",
        },
        features: [
            "월 2000+200회 AI 타이핑 생성",
            "팀 협업 기능",
            "API 액세스",
            "전담 지원 서비스",
            "최우선 업데이트",
            "복수 계정 작업 가능",
        ],
        cta: "Ultra 시작하기",
        tier: "pro",
    },
];

export default function Pricing() {
    const router = useRouter();
    const { isAuthenticated, loading, user } = useAuth();
    const [isPaying, setIsPaying] = useState(false);
    const [billingCycle, setBillingCycle] = useState<BillingCycle>("yearly");

    const paymentMetaByTier: Record<
        "go" | "plus" | "pro",
        Record<BillingCycle, { amount: number; orderName: string }>
    > = {
        go: {
            monthly: {
                amount: 11900,
                orderName: "Nova AI Go 요금제 (월간 결제)",
            },
            yearly: {
                amount: 99960,
                orderName: "Nova AI Go 요금제 (연간 결제, 월 30% 할인 적용)",
            },
        },
        plus: {
            monthly: {
                amount: 29900,
                orderName: "Nova AI Plus 요금제 (월간 결제)",
            },
            yearly: {
                amount: 251160,
                orderName: "Nova AI Plus 요금제 (연간 결제, 월 30% 할인 적용)",
            },
        },
        pro: {
            monthly: { amount: 99000, orderName: "Nova AI Ultra 요금제 (월간 결제)" },
            yearly: {
                amount: 831600,
                orderName: "Nova AI Ultra 요금제 (연간 결제, 월 30% 할인 적용)",
            },
        },
    };

    const billingLabel = "/월";

    const handlePlanClick = async (
        event: MouseEvent<HTMLButtonElement>,
        tier: PricingPlan["tier"],
    ) => {
        event.preventDefault();

        if (tier === "free") {
            router.push("/login");
            return;
        }

        if (loading || isPaying) return;

        const paymentMeta = paymentMetaByTier[tier][billingCycle];

        if (!isAuthenticated) {
            const loginParams = new URLSearchParams({
                postLoginAction: "payment",
                amount: String(paymentMeta.amount),
                orderName: paymentMeta.orderName,
                billingCycle,
            });
            router.push(`/login?${loginParams.toString()}`);
            return;
        }

        if (!user?.uid) {
            window.alert("로그인 정보를 확인한 후 다시 시도해주세요.");
            return;
        }

        try {
            setIsPaying(true);

            const clientKey = process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY?.trim() || "";

            if (
                !clientKey.startsWith("test_ck_") &&
                !clientKey.startsWith("live_ck_")
            ) {
                window.alert(
                    "토스 결제 클라이언트 키 형식이 올바르지 않습니다. NEXT_PUBLIC_TOSS_CLIENT_KEY를 확인해주세요.",
                );
                return;
            }

            const tossPayments = await loadTossPayments(clientKey);
            const payment = tossPayments.payment({
                customerKey: `user_${user.uid
                    .replace(/[^a-zA-Z0-9\-_=.@]/g, "")
                    .substring(0, 40)}`,
            });

            await payment.requestPayment({
                method: "CARD",
                amount: {
                    value: paymentMeta.amount,
                    currency: "KRW",
                },
                orderId: `order_${Date.now()}`,
                orderName: paymentMeta.orderName,
                successUrl: `${window.location.origin}/payment/success?billingCycle=${billingCycle}&uid=${encodeURIComponent(user.uid)}`,
                failUrl: `${window.location.origin}/payment/fail?billingCycle=${billingCycle}`,
                customerEmail: user.email || "test@example.com",
                customerName: user.displayName || "고객",
            });
        } catch (error: any) {
            window.alert(error?.message || "결제 요청 중 오류가 발생했습니다.");
        } finally {
            setIsPaying(false);
        }
    };

    return (
        <section id="pricing" className="pricing-section">
            <div className="section-inner">
                <div className="pricing-header">
                    <h2 className="pricing-title">이용 요금 안내</h2>
                    <p className="pricing-subtitle">
                        합리적인 가격으로 강력한 AI 기능을 경험하세요.
                        <br />
                        필요에 맞는 요금제를 선택하고 지금 바로 시작하세요.
                    </p>
                    <div className="pricing-billing-toggle" role="tablist" aria-label="결제 주기 선택">
                        <button
                            type="button"
                            role="tab"
                            aria-selected={billingCycle === "monthly"}
                            className={`pricing-billing-toggle__btn ${
                                billingCycle === "monthly"
                                    ? "pricing-billing-toggle__btn--active"
                                    : ""
                            }`}
                            onClick={() => setBillingCycle("monthly")}
                        >
                            월간 결제
                        </button>
                        <div className="pricing-billing-toggle__annual-wrap">
                            <span className="pricing-billing-toggle__discount-badge">
                                30% 할인
                            </span>
                            <button
                                type="button"
                                role="tab"
                                aria-selected={billingCycle === "yearly"}
                                className={`pricing-billing-toggle__btn ${
                                    billingCycle === "yearly"
                                        ? "pricing-billing-toggle__btn--active"
                                        : ""
                                }`}
                                onClick={() => setBillingCycle("yearly")}
                            >
                                연간 결제
                            </button>
                        </div>
                    </div>
                </div>

                <div className="pricing-cards-wrapper">
                    {plans.map((plan) => (
                        <div
                            key={plan.name}
                            className={`pricing-card-v2 pricing-card-v2--${plan.tier} ${
                                plan.popular ? "pricing-card-v2--popular" : ""
                            }`}
                        >
                            <div className="pricing-card-v2__content">
                                <div className="pricing-card-v2__header">
                                    <div className="pricing-card-v2__title-row">
                                        <h3 className="pricing-card-v2__name">
                                            {plan.name}
                                        </h3>
                                        {plan.popular && (
                                            <div className="pricing-badge-v2">
                                                <span>BEST</span>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                <div className="pricing-card-v2__price-block">
                                    <div className="pricing-card-v2__price-row">
                                        {plan.prices[billingCycle] !== "0" && (
                                            <span className="pricing-card-v2__currency">
                                                ₩
                                            </span>
                                        )}
                                        <span className="pricing-card-v2__price">
                                            {plan.prices[billingCycle] === "0"
                                                ? "Free"
                                                : plan.prices[billingCycle]}
                                        </span>
                                        {plan.prices[billingCycle] !== "0" && (
                                            <span className="pricing-card-v2__unit">
                                                {billingLabel}
                                            </span>
                                        )}
                                    </div>
                                </div>

                                <div className="pricing-card-v2__cta-wrap">
                                    <button
                                        type="button"
                                        onClick={(event) => handlePlanClick(event, plan.tier)}
                                        className={`pricing-cta-v2 pricing-cta-v2--${plan.tier}`}
                                    >
                                        {plan.cta}
                                    </button>
                                </div>

                                <p className="pricing-card-v2__desc">
                                    {plan.subDescription}
                                </p>

                                <ul className="pricing-card-v2__features">
                                    {plan.features.map((feature, i) => (
                                        <li
                                            key={i}
                                            className="pricing-card-v2__feature"
                                        >
                                            <span className="pricing-card-v2__check-wrap">
                                                <CheckIcon
                                                    color={
                                                        plan.popular
                                                            ? "#ccc"
                                                            : "#555"
                                                    }
                                                />
                                            </span>
                                            <span>{feature}</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
}
