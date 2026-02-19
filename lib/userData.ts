export type UserPlan = "free" | "go" | "plus" | "pro" | "test";

type PlainObject = Record<string, unknown>;

const PLAN_VALUES: UserPlan[] = ["free", "go", "plus", "pro", "test"];

export function nowIsoString(): string {
    return new Date().toISOString();
}

export function normalizePlanLike(value: unknown, fallback: UserPlan = "free"): UserPlan {
    if (typeof value !== "string") return fallback;
    const normalized = value.trim().toLowerCase();
    return PLAN_VALUES.includes(normalized as UserPlan)
        ? (normalized as UserPlan)
        : fallback;
}

export function sanitizeForFirestore<T>(value: T): T {
    if (value === undefined) {
        return undefined as T;
    }
    if (value === null || typeof value !== "object") {
        return value;
    }
    if (Array.isArray(value)) {
        return value.map((item) => sanitizeForFirestore(item)) as T;
    }

    const result: PlainObject = {};
    for (const [key, raw] of Object.entries(value as PlainObject)) {
        if (raw === undefined) continue;
        result[key] = sanitizeForFirestore(raw);
    }
    return result as T;
}

export function inferPlanFromAmount(
    amount: number,
    billingCycle?: "monthly" | "yearly" | "test" | string | null,
): UserPlan {
    if (billingCycle === "test") return "test";
    // Keep compatibility with legacy/test prices and current production prices.
    if (amount === 100 || amount === 60 || amount === 720 || amount === 840) return "plus";
    if (amount === 11900 || amount === 99960) return "go";
    if (amount === 59400 || amount === 712800 || amount === 831600) return "pro";
    if (amount === 29900 || amount === 251160) return "plus";
    if (amount === 99000) return "pro";
    if (amount >= 11900 && amount < 29900) return "go";
    if (amount > 29900 && amount < 99000) return "plus";
    if (amount > 99000) return "pro";
    if (amount > 0) return "plus";
    return "free";
}

export function normalizeCreatedAt(value: unknown): string {
    if (typeof value === "string") {
        const parsed = new Date(value);
        if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
        const parsed = new Date(value);
        if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
    }
    return nowIsoString();
}

export function buildUserRootPatch(params: {
    existingUser?: PlainObject | null;
    profile?: {
        displayName?: string | null;
        email?: string | null;
        avatar?: string | null;
    };
    subscription?: PlainObject;
    plan?: UserPlan;
    aiCallUsage?: number;
    usageResetAt?: string;
}): PlainObject {
    const existing = params.existingUser ?? {};
    const patch: PlainObject = {
        updatedAt: nowIsoString(),
    };

    const existingCreatedAt = (existing as PlainObject).createdAt;
    patch.createdAt = normalizeCreatedAt(existingCreatedAt);

    const existingPlan = normalizePlanLike((existing as PlainObject).plan, "free");
    const nextPlan = normalizePlanLike(params.plan ?? existingPlan, "free");
    patch.plan = nextPlan;
    // Keep legacy tier in sync for desktop clients that still read tier.
    patch.tier = nextPlan;

    const existingUsage = (existing as PlainObject).aiCallUsage;
    patch.aiCallUsage =
        typeof params.aiCallUsage === "number"
            ? params.aiCallUsage
            : typeof existingUsage === "number"
              ? existingUsage
              : 0;

    const existingUsageResetAt = (existing as PlainObject).usageResetAt;
    patch.usageResetAt =
        typeof params.usageResetAt === "string"
            ? params.usageResetAt
            : typeof existingUsageResetAt === "string"
              ? existingUsageResetAt
              : undefined;

    if (params.profile) {
        const profile = params.profile;
        if ("displayName" in profile) patch.displayName = profile.displayName ?? null;
        if ("email" in profile) patch.email = profile.email ?? null;
        if ("avatar" in profile) patch.avatar = profile.avatar ?? null;
    }

    if (params.subscription) {
        patch.subscription = sanitizeForFirestore(params.subscription);
    }

    return sanitizeForFirestore(patch);
}
