export const DEFAULT_NOTICE_SLUGS = ["1"] as const;

export function isDefaultNoticeSlug(slug: string) {
    return DEFAULT_NOTICE_SLUGS.includes(slug as (typeof DEFAULT_NOTICE_SLUGS)[number]);
}
