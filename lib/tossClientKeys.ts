const DEFAULT_ONE_TIME_TOSS_CLIENT_KEY =
    "live_ck_yL0qZ4G1VOdnnBnLxnjBroWb2MQY";
const DEFAULT_BILLING_TOSS_CLIENT_KEY =
    "live_ck_yL0qZ4G1VOdnnBnLxnjBroWb2MQY";

export function resolveOneTimeTossClientKey(): string {
    return (
        process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY?.trim() ||
        process.env.NEXT_PUBLIC_TOSS_BILLING_CLIENT_KEY?.trim() ||
        DEFAULT_ONE_TIME_TOSS_CLIENT_KEY
    );
}

export function resolveBillingTossClientKey(): string {
    return (
        process.env.NEXT_PUBLIC_TOSS_BILLING_CLIENT_KEY?.trim() ||
        DEFAULT_BILLING_TOSS_CLIENT_KEY
    );
}

export function isValidOneTimeTossClientKey(clientKey: string): boolean {
    return (
        clientKey.startsWith("test_gck_") ||
        clientKey.startsWith("live_gck_") ||
        clientKey.startsWith("test_ck_") ||
        clientKey.startsWith("live_ck_")
    );
}
