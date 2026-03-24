import { inferPlanFromAmount } from "@/lib/userData";
import {
    estimateTokensFromProblemCount,
    getTierLimit,
    LEGACY_LIMIT_OVERRIDE_UNTIL,
    PlanTier,
} from "@/lib/tierLimits";

type PlainObject = Record<string, any>;

export type UsageRecordLike = {
    feature?: unknown;
    promptTokens?: unknown;
    outputTokens?: unknown;
    totalTokens?: unknown;
    usageNormalized?: unknown;
};

export function normalizeUsageTokens(
    feature: unknown,
    promptTokensInput: unknown,
    outputTokensInput: unknown,
    totalTokensInput: unknown,
) {
    const featureKey = String(feature || "").trim().toLowerCase();
    const promptTokens = Math.max(0, Math.floor(Number(promptTokensInput || 0)));
    const outputTokens = Math.max(0, Math.floor(Number(outputTokensInput || 0)));
    const rawTotalTokens = Math.max(
        0,
        Math.floor(Number(totalTokensInput || promptTokens + outputTokens)),
    );

    let billedPromptTokens = promptTokens;
    let billedOutputTokens = outputTokens;

    if (featureKey === "typing_problem" || featureKey === "typing") {
        billedOutputTokens *= 2;
    } else if (featureKey === "image_generation") {
        billedPromptTokens *= 2;
        billedOutputTokens *= 2;
    }

    const billedTotalTokens =
        promptTokens > 0 || outputTokens > 0
            ? billedPromptTokens + billedOutputTokens
            : rawTotalTokens;

    return {
        promptTokens: billedPromptTokens,
        outputTokens: billedOutputTokens,
        totalTokens: billedTotalTokens,
    };
}

export function resolveBilledUsageAmount(input: {
    amount?: unknown;
    feature?: unknown;
    promptTokens?: unknown;
    outputTokens?: unknown;
    totalTokens?: unknown;
    usageNormalized?: unknown;
    usageRecords?: UsageRecordLike[] | unknown;
}): number {
    const usageRecords = Array.isArray(input.usageRecords) ? input.usageRecords : [];
    if (usageRecords.length > 0) {
        const total = usageRecords.reduce((sum, record) => {
            const usageAlreadyNormalized = Boolean(record?.usageNormalized);
            const promptTokens = Math.max(
                0,
                Math.floor(Number(record?.promptTokens || 0)),
            );
            const outputTokens = Math.max(
                0,
                Math.floor(Number(record?.outputTokens || 0)),
            );
            const rawTotalTokens = Math.max(
                0,
                Math.floor(Number(record?.totalTokens || promptTokens + outputTokens)),
            );
            const billed = usageAlreadyNormalized
                ? rawTotalTokens
                : normalizeUsageTokens(
                      record?.feature,
                      record?.promptTokens,
                      record?.outputTokens,
                      record?.totalTokens,
                  ).totalTokens;
            return sum + billed;
        }, 0);
        return Math.max(0, Math.floor(total));
    }

    const usageAlreadyNormalized = Boolean(input.usageNormalized);
    if (
        input.feature !== undefined ||
        input.promptTokens !== undefined ||
        input.outputTokens !== undefined ||
        input.totalTokens !== undefined
    ) {
        if (usageAlreadyNormalized) {
            return Math.max(0, Math.floor(Number(input.totalTokens || 0)));
        }
        return normalizeUsageTokens(
            input.feature,
            input.promptTokens,
            input.outputTokens,
            input.totalTokens,
        ).totalTokens;
    }

    const numericAmount = Number(input.amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
        return 0;
    }
    return Math.floor(numericAmount);
}

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

export function getStoredExtraTokenBalance(userData: PlainObject): number {
    return normalizeStoredTokenLikeValue(userData.extraTokenBalance);
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

export function getRemainingSubscriptionTokens(
    userData: PlainObject,
    plan: PlanTier,
    now = new Date(),
): number {
    const limit = resolveEffectiveUsageLimit(userData, plan, now);
    const currentUsage = getStoredUsageTokens(userData);
    return Math.max(0, limit - currentUsage);
}

export function buildInitialUsageFields(
    userData: PlainObject,
    resetAt?: string,
): Record<string, unknown> {
    const iso = resetAt || new Date().toISOString();
    return {
        aiCallUsage: 0,
        aiUsageMode: "tokens",
        usageResetAt: iso,
        extraTokenBalance: 0,
    };
}

export function buildUsageCycleResetFields(
    userData: PlainObject,
    plan: PlanTier,
    resetAt?: string,
): {
    aiCallUsage: number;
    aiUsageMode: "tokens";
    usageResetAt: string;
    extraTokenBalance: number;
} {
    const iso = resetAt || new Date().toISOString();
    return {
        aiCallUsage: 0,
        aiUsageMode: "tokens",
        usageResetAt: iso,
        extraTokenBalance: 0,
    };
}

export function buildUsageConsumptionResult(
    userData: PlainObject,
    plan: PlanTier,
    amount: number,
    now = new Date(),
):
    | {
          canConsume: false;
          limit: number;
          totalRemaining: number;
      }
    | {
          canConsume: true;
          limit: number;
          nextUsage: number;
          nextExtraTokenBalance: number;
          totalRemainingAfter: number;
      } {
    const usageAmount =
        Number.isFinite(amount) && amount > 0 ? Math.floor(amount) : 0;
    const limit = resolveEffectiveUsageLimit(userData, plan, now);
    const currentUsage = getStoredUsageTokens(userData);
    const totalRemaining = Math.max(0, limit - currentUsage);

    if (usageAmount <= 0) {
        return {
            canConsume: true,
            limit,
            nextUsage: currentUsage,
            nextExtraTokenBalance: 0,
            totalRemainingAfter: totalRemaining,
        };
    }

    if (usageAmount > totalRemaining) {
        return {
            canConsume: false,
            limit,
            totalRemaining,
        };
    }

    return {
        canConsume: true,
        limit,
        nextUsage: currentUsage + usageAmount,
        nextExtraTokenBalance: 0,
        totalRemainingAfter: totalRemaining - usageAmount,
    };
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

export function buildUsageResetFields(
    resetAt?: string,
    _extraTokenBalance = 0,
): Record<string, unknown> {
    const iso = resetAt || new Date().toISOString();
    return {
        aiCallUsage: 0,
        aiUsageMode: "tokens",
        usageResetAt: iso,
        extraTokenBalance: 0,
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
    if (
        normalizedOrderName.includes("추가 토큰") &&
        normalizedOrderName.includes("단건 결제")
    ) {
        return "free";
    }
    if (normalizedOrderName.includes("ultra") || normalizedOrderName.includes("pro")) {
        return "pro";
    }
    if (normalizedOrderName.includes("plus")) return "plus";
    if (normalizedOrderName.includes("go")) return "go";
    return "free";
}
