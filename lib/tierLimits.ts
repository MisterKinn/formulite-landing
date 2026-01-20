// Tier limits configuration
export const TIER_LIMITS = {
    free: 5,
    basic: 100,
    plus: 500,
    pro: 1500,
} as const;

export type PlanTier = keyof typeof TIER_LIMITS;

export function getTierLimit(tier: PlanTier): number {
    return TIER_LIMITS[tier] || TIER_LIMITS.free;
}
