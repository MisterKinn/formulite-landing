import { inferPlanFromAmount } from "@/lib/userData";
import { PlanTier } from "@/lib/tierLimits";

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

export function resolveEffectiveUsagePlan(userData: PlainObject): PlanTier {
    const rootPlan = normalizePlan(userData.plan);
    const subscriptionPlan = normalizePlan(userData.subscription?.plan);
    const tierPlan = normalizePlan(userData.tier);

    if (rootPlan === "pro" || subscriptionPlan === "pro" || tierPlan === "pro") {
        return "pro";
    }

    if (
        rootPlan === "plus" ||
        subscriptionPlan === "plus" ||
        tierPlan === "plus"
    ) {
        return "plus";
    }

    if (rootPlan === "go" || subscriptionPlan === "go" || tierPlan === "go") {
        return "go";
    }

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

export function getUsageResetAnchor(userData: PlainObject): string | null {
    const lastPaymentDate = parseDate(userData.subscription?.lastPaymentDate);
    if (lastPaymentDate) return lastPaymentDate.toISOString();

    const registeredAt = parseDate(userData.subscription?.registeredAt);
    if (registeredAt) return registeredAt.toISOString();

    const startDate = parseDate(userData.subscription?.startDate);
    if (startDate) return startDate.toISOString();

    return null;
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

export function buildUsageResetFields(resetAt?: string): Record<string, any> {
    const iso = resetAt || new Date().toISOString();
    return {
        aiCallUsage: 0,
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
