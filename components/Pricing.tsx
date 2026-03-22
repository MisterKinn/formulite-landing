"use client";

import { MouseEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { loadTossPayments } from "@tosspayments/tosspayments-sdk";

interface PricingTokenLine {
    prefix?: string;
    value: string;
    suffix?: string;
}

interface PricingTokenInfo {
    label: string;
    lines: PricingTokenLine[];
}

interface PricingPlan {
    name: string;
    subDescription: string;
    prices: {
        monthly: string;
        yearly: string;
    };
    tokenInfo: PricingTokenInfo;
    cta: string;
    popular?: boolean;
    tier: "free" | "go" | "plus" | "pro";
}

type BillingCycle = "monthly" | "yearly";

const TOKENS_PER_PROBLEM = 25000;

const formatTokenNumber = (count: number) => count.toLocaleString();

const formatTokenAllowance = (baseProblems: number, bonusProblems?: number) => {
    const baseTokens = baseProblems * TOKENS_PER_PROBLEM;
    if (!bonusProblems) {
        return {
            label: "총 토큰",
            lines: [
                {
                    value: formatTokenNumber(baseTokens),
                    suffix: "토큰",
                },
            ],
        };
    }

    const bonusTokens = bonusProblems * TOKENS_PER_PROBLEM;
    return {
        label: "월 토큰",
        lines: [
            {
                value: formatTokenNumber(baseTokens),
                suffix: "기본토큰",
            },
            {
                value: formatTokenNumber(bonusTokens),
                suffix: "추가토큰",
            },
        ],
    };
};

const plans: PricingPlan[] = [
    {
        name: "Free 요금제",
        subDescription: "기본 요금제로 다양한 서비스를 먼저 경험해보세요.",
        prices: {
            monthly: "0",
            yearly: "0",
        },
        tokenInfo: formatTokenAllowance(3),
        cta: "무료로 시작하기",
        tier: "free",
    },
    {
        name: "Go 요금제",
        subDescription: "개인에 적합한 플랜입니다.",
        prices: {
            monthly: "11,900",
            yearly: "8,330",
        },
        tokenInfo: formatTokenAllowance(60, 6),
        cta: "Go 시작하기",
        tier: "go",
    },
    {
        name: "Plus 요금제",
        subDescription: "학원 선생님이 선택하면 좋은 플랜입니다.",
        prices: {
            monthly: "29,900",
            yearly: "20,930",
        },
        tokenInfo: formatTokenAllowance(200, 20),
        cta: "Plus 시작하기",
        popular: true,
        tier: "plus",
    },
    {
        name: "Ultra 요금제",
        subDescription: "학원에서 사용하면 좋은 플랜입니다.",
        prices: {
            monthly: "99,000",
            yearly: "69,300",
        },
        tokenInfo: formatTokenAllowance(1200, 120),
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
    const formatTotalPriceLabel = (amount: number) =>
        `총 ${amount.toLocaleString()}원 결제`;

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

            const clientKey =
                process.env.NEXT_PUBLIC_TOSS_BILLING_CLIENT_KEY?.trim() ||
                process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY?.trim() ||
                "";

            const tossPayments = await loadTossPayments(clientKey);
            const customerKey = `user_${user.uid
                .replace(/[^a-zA-Z0-9\-_=.@]/g, "")
                .substring(0, 40)}`;
            const payment = tossPayments.payment({ customerKey });

            await payment.requestBillingAuth({
                method: "CARD",
                successUrl: `${window.location.origin}/card-registration/success?amount=${paymentMeta.amount}&orderName=${encodeURIComponent(paymentMeta.orderName)}&billingCycle=${billingCycle}`,
                failUrl: `${window.location.origin}/card-registration/fail?amount=${paymentMeta.amount}&orderName=${encodeURIComponent(paymentMeta.orderName)}`,
                customerEmail: user.email || "customer@example.com",
                customerName: user.displayName || "고객",
            });
        } catch (error: unknown) {
            const err = error as { code?: string; message?: string };
            if (err?.code !== "USER_CANCEL") {
                window.alert(err?.message || "결제 요청 중 오류가 발생했습니다.");
            }
        } finally {
            setIsPaying(false);
        }
    };

    return (
        <section id="pricing" className="pricing-section">
            <div className="section-inner">
                <div className="pricing-header">
                    <div className="pricing-label">PRICE</div>
                    <h2 className="pricing-title">작업량에 맞는 요금제</h2>
                    <p className="pricing-subtitle">
                        개인 작업부터 팀 단위 운영까지, 필요한 수준에 맞게 선택할 수 있습니다.
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
                                                <span>가장 많이 선택</span>
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
                                    {billingCycle === "yearly" &&
                                        plan.tier !== "free" && (
                                            <p className="pricing-card-v2__price-total">
                                                {formatTotalPriceLabel(
                                                    paymentMetaByTier[plan.tier]
                                                        .yearly.amount,
                                                )}
                                            </p>
                                        )}
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

                                <div className="pricing-card-v2__divider" />
                                <div className="pricing-card-v2__token-block">
                                    <span className="pricing-card-v2__token-label">
                                        {plan.tokenInfo.label}
                                    </span>
                                    <div className="pricing-card-v2__token-values">
                                        {plan.tokenInfo.lines.map((line, index) => (
                                            <span
                                                key={`${plan.tier}-token-line-${index}`}
                                                className="pricing-card-v2__token-line"
                                            >
                                                {line.prefix && (
                                                    <span className="pricing-card-v2__token-prefix">
                                                        {line.prefix}
                                                    </span>
                                                )}
                                                <span className="pricing-card-v2__token-value">
                                                    {line.value}
                                                </span>
                                                {line.suffix && (
                                                    <span className="pricing-card-v2__token-suffix">
                                                        {line.suffix}
                                                    </span>
                                                )}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
}
