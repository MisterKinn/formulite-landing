import { inferPlanFromAmount } from "@/lib/userData";
import { PlanTier } from "@/lib/tierLimits";
import {
    isSubscriptionPeriodEnded,
    resolveEffectiveUsagePlan,
} from "@/lib/aiUsage";

export type TokenPackTier = Exclude<PlanTier, "free">;
export type PaymentProductKind = "subscription" | "token_pack" | "unknown";

export interface TokenPackProduct {
    tier: TokenPackTier;
    amount: number;
    tokens: number;
    orderName: string;
    title: string;
}

export const TOKEN_PACK_PRODUCTS: Record<TokenPackTier, TokenPackProduct> = {
    go: {
        tier: "go",
        amount: 11900,
        tokens: 1_300_000,
        orderName: "Nova AI 토큰 130만 단건 결제",
        title: "토큰 130만",
    },
    plus: {
        tier: "plus",
        amount: 29900,
        tokens: 3_500_000,
        orderName: "Nova AI 토큰 350만 단건 결제",
        title: "토큰 350만",
    },
    pro: {
        tier: "pro",
        amount: 49900,
        tokens: 10_000_000,
        orderName: "Nova AI 토큰 1000만 단건 결제",
        title: "토큰 1,000만",
    },
};

export interface PaymentProductResolution {
    kind: PaymentProductKind;
    plan?: TokenPackTier;
    tokenPack?: TokenPackProduct;
}

export function getTokenPackProduct(
    tier: TokenPackTier,
): TokenPackProduct {
    return TOKEN_PACK_PRODUCTS[tier];
}

export function getTokenPackProducts(): TokenPackProduct[] {
    return Object.values(TOKEN_PACK_PRODUCTS);
}

export function getTokenPackByOrderName(
    orderName: unknown,
): TokenPackProduct | null {
    const normalized = String(orderName || "").trim().toLowerCase();
    if (!normalized) return null;

    return (
        getTokenPackProducts().find(
            (product) => product.orderName.toLowerCase() === normalized,
        ) || null
    );
}

export function isTokenPackOrderName(orderName: unknown): boolean {
    return getTokenPackByOrderName(orderName) !== null;
}

export function resolvePaymentProduct(input: {
    orderName?: unknown;
    amount?: unknown;
    billingCycle?: unknown;
}): PaymentProductResolution {
    const tokenPack = getTokenPackByOrderName(input.orderName);
    if (tokenPack) {
        return {
            kind: "token_pack",
            plan: tokenPack.tier,
            tokenPack,
        };
    }

    const orderName = String(input.orderName || "").toLowerCase();
    if (orderName.includes("ultra") || orderName.includes("pro")) {
        return { kind: "subscription", plan: "pro" };
    }
    if (orderName.includes("plus")) {
        return { kind: "subscription", plan: "plus" };
    }
    if (orderName.includes("go")) {
        return { kind: "subscription", plan: "go" };
    }

    const amount = Number(input.amount || 0);
    if (Number.isFinite(amount) && amount > 0) {
        const inferred = inferPlanFromAmount(
            amount,
            typeof input.billingCycle === "string" ? input.billingCycle : undefined,
        );
        if (inferred === "go" || inferred === "plus" || inferred === "pro") {
            return { kind: "subscription", plan: inferred };
        }
    }

    return { kind: "unknown" };
}

export function canPurchaseTokenPack(
    userData: Record<string, unknown> | null | undefined,
): boolean {
    if (!userData) return false;

    const plan = resolveEffectiveUsagePlan(userData);

    if (isSubscriptionPeriodEnded(userData)) {
        return false;
    }

    return plan === "go" || plan === "plus" || plan === "pro";
}
