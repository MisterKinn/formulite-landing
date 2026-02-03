// Tier limits configuration
export const TIER_LIMITS = {
    free: 5,
    test: 10,
    plus: 110,
    pro: 330,
} as const;

export type PlanTier = keyof typeof TIER_LIMITS;

export function getTierLimit(tier: PlanTier): number {
    return TIER_LIMITS[tier] || TIER_LIMITS.free;
}
