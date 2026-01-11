// Payment error handling utilities

export class PaymentError extends Error {
    code: string;
    userMessage: string;

    constructor(code: string, message: string, userMessage: string) {
        super(message);
        this.code = code;
        this.userMessage = userMessage;
        this.name = "PaymentError";
    }
}

// Parse Toss Payments error codes
export function parseTossError(error: any): PaymentError {
    const code = error.code || "UNKNOWN_ERROR";
    const message = error.message || "알 수 없는 오류가 발생했습니다.";

    const errorMap: Record<string, string> = {
        // Card errors
        INVALID_CARD_NUMBER: "유효하지 않은 카드 번호입니다.",
        INVALID_CARD_EXPIRATION: "카드 유효기간을 확인해주세요.",
        INVALID_CARD_CVC: "CVC 번호를 확인해주세요.",
        CARD_EXPIRED: "카드가 만료되었습니다. 다른 카드를 사용해주세요.",
        NOT_SUPPORTED_CARD: "지원하지 않는 카드입니다.",

        // Payment errors
        INSUFFICIENT_FUNDS: "잔액이 부족합니다.",
        EXCEED_MAX_AMOUNT: "결제 한도를 초과했습니다.",
        EXCEED_MAX_DAILY_AMOUNT: "일일 한도를 초과했습니다.",
        PAYMENT_DECLINED: "결제가 거절되었습니다. 카드사에 문의해주세요.",

        // Authentication errors
        INVALID_API_KEY: "결제 설정 오류입니다. 관리자에게 문의하세요.",
        UNAUTHORIZED: "인증에 실패했습니다.",

        // Billing errors
        ALREADY_APPROVED: "이미 승인된 결제입니다.",
        PROVIDER_ERROR: "결제 처리 중 오류가 발생했습니다.",
        FAILED_INTERNAL_SYSTEM_PROCESSING:
            "시스템 오류가 발생했습니다. 잠시 후 다시 시도해주세요.",

        // User errors
        USER_CANCEL: "결제가 취소되었습니다.",
        TIMEOUT: "결제 시간이 초과되었습니다.",
    };

    const userMessage = errorMap[code] || message;

    return new PaymentError(code, message, userMessage);
}

// Retry logic for transient errors
export async function retryPaymentOperation<T>(
    operation: () => Promise<T>,
    maxRetries: number = 3,
    delayMs: number = 1000
): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await operation();
        } catch (error: any) {
            lastError = error;

            // Don't retry user errors or permanent failures
            const nonRetryableCodes = [
                "INVALID_CARD_NUMBER",
                "CARD_EXPIRED",
                "USER_CANCEL",
                "INSUFFICIENT_FUNDS",
                "PAYMENT_DECLINED",
            ];

            if (error.code && nonRetryableCodes.includes(error.code)) {
                throw error;
            }

            console.log(
                `⚠️ Attempt ${attempt}/${maxRetries} failed:`,
                error.message
            );

            if (attempt < maxRetries) {
                await new Promise((resolve) =>
                    setTimeout(resolve, delayMs * attempt)
                );
            }
        }
    }

    throw lastError || new Error("Max retries exceeded");
}

// Log payment errors to monitoring service
export function logPaymentError(error: any, context?: Record<string, any>) {
    const errorData = {
        timestamp: new Date().toISOString(),
        ...context,
        errorCode: error.code,
        errorMessage: error.message,
        userMessage: error.userMessage,
        stack: error.stack,
    };

    console.error("💳 Payment Error:", errorData);

    // TODO: Send to monitoring service (Sentry, LogRocket, etc.)
    // Example:
    // if (process.env.SENTRY_DSN) {
    //     Sentry.captureException(error, { extra: errorData });
    // }
}

// Validate payment amount
export function validatePaymentAmount(amount: number): {
    valid: boolean;
    error?: string;
} {
    if (!amount || amount <= 0) {
        return {
            valid: false,
            error: "결제 금액이 올바르지 않습니다.",
        };
    }

    if (amount < 100) {
        return {
            valid: false,
            error: "최소 결제 금액은 100원입니다.",
        };
    }

    if (amount > 10000000) {
        return {
            valid: false,
            error: "최대 결제 금액은 1,000만원입니다.",
        };
    }

    return { valid: true };
}

// Check if error is retryable
export function isRetryableError(error: any): boolean {
    const retryableCodes = [
        "PROVIDER_ERROR",
        "FAILED_INTERNAL_SYSTEM_PROCESSING",
        "TIMEOUT",
    ];

    return error.code && retryableCodes.includes(error.code);
}
