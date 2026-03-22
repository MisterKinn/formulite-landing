import { inferPlanFromAmount } from "@/lib/userData";
import {
    estimateTokensFromProblemCount,
    getTierLimit,
    LEGACY_LIMIT_OVERRIDE_UNTIL,
    PlanTier,
} from "@/lib/tierLimits";

type PlainObject = Record<string, any>;

function normalizePlan(value: unknown): PlanTier {
    if (typeof value !== "string") return "free";
    const normalized = value.trim().toLowerCase();
    if (normalized === "pro" || normalized === "ultra") return "pro";
    if (normalized === "go") return "go";
    if (normalized === "plus") return "plus";
    if (normalized === "test") return "plus";
    return "free";
}

function hasExplicitFreePlan(value: unknown): boolean {
    return typeof value === "string" && normalizePlan(value) === "free";
}

function addBillingCycle(date: Date, billingCycle: unknown): Date {
    const next = new Date(date);
    if (billingCycle === "yearly") {
        next.setFullYear(next.getFullYear() + 1);
        return next;
    }
    if (billingCycle === "test") {
        next.setTime(next.getTime() + 60 * 1000);
        return next;
    }
    next.setMonth(next.getMonth() + 1);
    return next;
}

export function resolveSubscriptionPeriodEnd(userData: PlainObject): string | null {
    const nextBillingDate = parseDate(userData.subscription?.nextBillingDate);
    if (nextBillingDate) return nextBillingDate.toISOString();

    const lastPaymentDate = parseDate(userData.subscription?.lastPaymentDate);
    if (lastPaymentDate) {
        return addBillingCycle(
            lastPaymentDate,
            userData.subscription?.billingCycle,
        ).toISOString();
    }

    const registeredAt = parseDate(userData.subscription?.registeredAt);
    if (registeredAt) {
        return addBillingCycle(
            registeredAt,
            userData.subscription?.billingCycle,
        ).toISOString();
    }

    const startDate = parseDate(userData.subscription?.startDate);
    if (startDate) {
        return addBillingCycle(
            startDate,
            userData.subscription?.billingCycle,
        ).toISOString();
    }

    return null;
}

export function isSubscriptionPeriodEnded(
    userData: PlainObject,
    now = new Date(),
): boolean {
    const subscriptionStatus = String(
        userData.subscription?.status || "",
    ).toLowerCase();

    if (subscriptionStatus === "expired") {
        return true;
    }

    if (subscriptionStatus !== "cancelled") {
        return false;
    }

    const periodEnd = resolveSubscriptionPeriodEnd(userData);
    if (!periodEnd) {
        return false;
    }

    return new Date(periodEnd).getTime() <= now.getTime();
}

export function resolveEffectiveUsagePlan(userData: PlainObject): PlanTier {
    const rootPlan = normalizePlan(userData.plan);
    const subscriptionPlan = normalizePlan(userData.subscription?.plan);
    const tierPlan = normalizePlan(userData.tier);
    const subscriptionStatus = String(userData.subscription?.status || "").toLowerCase();
    const subscriptionEnded = isSubscriptionPeriodEnded(userData);

    if (subscriptionEnded) {
        return "free";
    }

    if (subscriptionStatus === "cancelled" && subscriptionPlan === "pro") {
        return "pro";
    }

    if (subscriptionStatus === "cancelled" && subscriptionPlan === "plus") {
        return "plus";
    }

    if (subscriptionStatus === "cancelled" && subscriptionPlan === "go") {
        return "go";
    }

    if (subscriptionPlan === "pro") return "pro";
    if (subscriptionPlan === "plus") return "plus";
    if (subscriptionPlan === "go") return "go";

    if (rootPlan === "pro") return "pro";
    if (rootPlan === "plus") return "plus";
    if (rootPlan === "go") return "go";

    if (
        hasExplicitFreePlan(userData.plan) ||
        hasExplicitFreePlan(userData.tier) ||
        subscriptionPlan === "free" ||
        subscriptionStatus === "expired"
    ) {
        return "free";
    }

    if (tierPlan === "pro") return "pro";
    if (tierPlan === "plus") return "plus";
    if (tierPlan === "go") return "go";

    const amountRaw = userData.subscription?.amount;
    const amount =
        typeof amountRaw === "number"
            ? amountRaw
            : typeof amountRaw === "string"
              ? Number(amountRaw)
              : 0;

    if (Number.isFinite(amount) && amount > 0) {
        const inferred = inferPlanFromAmount(amount, userData.subscription?.billingCycle);
        if (inferred === "pro") return "pro";
        if (inferred === "plus" || inferred === "test") return "plus";
        if (inferred === "go") return "go";
    }

    const orderName = String(userData.subscription?.orderName || "").toLowerCase();
    if (orderName.includes("ultra") || orderName.includes("pro")) return "pro";
    if (orderName.includes("plus")) return "plus";
    if (orderName.includes("go")) return "go";

    return "free";
}

function parseDate(value: unknown): Date | null {
    if (typeof value !== "string") return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeStoredTokenLikeValue(value: unknown): number {
    const numeric = Number(value || 0);
    if (!Number.isFinite(numeric) || numeric <= 0) {
        return 0;
    }

    if (numeric < 10000) {
        return estimateTokensFromProblemCount(numeric);
    }

    return Math.floor(numeric);
}

export function getUsageResetAnchor(userData: PlainObject): string | null {
    const lastPaymentDate = parseDate(userData.subscription?.lastPaymentDate);
    if (lastPaymentDate) return lastPaymentDate.toISOString();

    const registeredAt = parseDate(userData.subscription?.registeredAt);
    if (registeredAt) return registeredAt.toISOString();

    const startDate = parseDate(userData.subscription?.startDate);
    if (startDate) return startDate.toISOString();

    return null;
}

export function getStoredUsageTokens(userData: PlainObject): number {
    return normalizeStoredTokenLikeValue(userData.aiCallUsage);
}

export function needsUsageResetFromPayment(
    userData: PlainObject,
    plan: PlanTier,
): { shouldReset: boolean; resetAt?: string } {
    if (plan === "free") return { shouldReset: false };

    const anchor = getUsageResetAnchor(userData);
    if (!anchor) return { shouldReset: false };

    const usageResetAt = parseDate(userData.usageResetAt);
    const anchorDate = new Date(anchor);
    if (!usageResetAt || usageResetAt.getTime() < anchorDate.getTime()) {
        return { shouldReset: true, resetAt: anchor };
    }

    return { shouldReset: false };
}

export function resolveEffectiveUsageLimit(
    userData: PlainObject,
    plan: PlanTier,
    now = new Date(),
): number {
    const overrideLimit = normalizeStoredTokenLikeValue(userData.aiLimitOverride);
    const overrideUntil = parseDate(userData.aiLimitOverrideUntil);

    if (
        Number.isFinite(overrideLimit) &&
        overrideLimit > 0 &&
        overrideUntil &&
        now.getTime() < overrideUntil.getTime()
    ) {
        return overrideLimit;
    }

    return getTierLimit(plan);
}

export function needsUsageResetFromLimitMigration(
    userData: PlainObject,
    now = new Date(),
): { shouldReset: boolean; resetAt?: string } {
    const overrideLimit = normalizeStoredTokenLikeValue(userData.aiLimitOverride);
    const overrideUntil =
        parseDate(userData.aiLimitOverrideUntil) ||
        parseDate(LEGACY_LIMIT_OVERRIDE_UNTIL);

    if (!Number.isFinite(overrideLimit) || overrideLimit <= 0 || !overrideUntil) {
        return { shouldReset: false };
    }

    if (now.getTime() < overrideUntil.getTime()) {
        return { shouldReset: false };
    }

    const usageResetAt = parseDate(userData.usageResetAt);
    if (!usageResetAt || usageResetAt.getTime() < overrideUntil.getTime()) {
        return {
            shouldReset: true,
            resetAt: overrideUntil.toISOString(),
        };
    }

    return { shouldReset: false };
}

export function buildUsageResetFields(resetAt?: string): Record<string, any> {
    const iso = resetAt || new Date().toISOString();
    return {
        aiCallUsage: 0,
        aiUsageMode: "tokens",
        usageResetAt: iso,
    };
}

export function inferPaidPlanFromPayment(payment: {
    amount?: unknown;
    orderName?: unknown;
    status?: unknown;
}): PlanTier {
    const status = String(payment.status || "").toUpperCase();
    if (status && (status.includes("REFUND") || status.includes("CANCEL"))) {
        return "free";
    }

    const amountValue =
        typeof payment.amount === "number"
            ? payment.amount
            : typeof payment.amount === "string"
              ? Number(payment.amount)
              : 0;

    if (Number.isFinite(amountValue) && amountValue > 0) {
        const inferred = inferPlanFromAmount(amountValue, "monthly");
        if (inferred === "pro") return "pro";
        if (inferred === "plus" || inferred === "test") return "plus";
        if (inferred === "go") return "go";
    }

    const normalizedOrderName = String(payment.orderName || "").toLowerCase();
    if (normalizedOrderName.includes("ultra") || normalizedOrderName.includes("pro")) {
        return "pro";
    }
    if (normalizedOrderName.includes("plus")) return "plus";
    if (normalizedOrderName.includes("go")) return "go";
    return "free";
}
