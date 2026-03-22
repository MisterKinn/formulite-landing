export const ESTIMATED_TOKENS_PER_PROBLEM = 25000;

// Legacy problem-equivalent limits kept for grandfathered paid users until the rollout date.
export const LEGACY_PROBLEM_LIMITS = {
    free: 5,
    go: 110,
    plus: 330,
    pro: 2200,
} as const;

// Rolled-out problem-equivalent limits.
export const PROBLEM_LIMITS = {
    free: 3,
    go: 66,
    plus: 220,
    pro: 1320,
} as const;

// Legacy token limits derived from the historical problem-equivalent allowances.
export const LEGACY_TIER_LIMITS = {
    free: LEGACY_PROBLEM_LIMITS.free * ESTIMATED_TOKENS_PER_PROBLEM,
    go: LEGACY_PROBLEM_LIMITS.go * ESTIMATED_TOKENS_PER_PROBLEM,
    plus: LEGACY_PROBLEM_LIMITS.plus * ESTIMATED_TOKENS_PER_PROBLEM,
    pro: LEGACY_PROBLEM_LIMITS.pro * ESTIMATED_TOKENS_PER_PROBLEM,
} as const;

// Token limits derived from the rolled-out problem-equivalent allowances.
export const TIER_LIMITS = {
    free: PROBLEM_LIMITS.free * ESTIMATED_TOKENS_PER_PROBLEM,
    go: PROBLEM_LIMITS.go * ESTIMATED_TOKENS_PER_PROBLEM,
    plus: PROBLEM_LIMITS.plus * ESTIMATED_TOKENS_PER_PROBLEM,
    pro: PROBLEM_LIMITS.pro * ESTIMATED_TOKENS_PER_PROBLEM,
} as const;

export const LEGACY_LIMIT_OVERRIDE_UNTIL = "2026-04-01T00:00:00+09:00";

export type PlanTier = keyof typeof TIER_LIMITS;

export function getTierLimit(tier: PlanTier): number {
    return TIER_LIMITS[tier] || TIER_LIMITS.free;
}

export function getLegacyTierLimit(tier: PlanTier): number {
    return LEGACY_TIER_LIMITS[tier] || LEGACY_TIER_LIMITS.free;
}

export function estimateTokensFromProblemCount(problemCount: number): number {
    return Math.max(0, Math.floor(problemCount)) * ESTIMATED_TOKENS_PER_PROBLEM;
}
