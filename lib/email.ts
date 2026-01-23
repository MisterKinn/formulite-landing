// Email notification system
import getFirebaseAdmin from "./firebaseAdmin";

interface PaymentReceiptData {
    orderId: string;
    amount: number;
    method: string;
    approvedAt: string;
    plan?: string;
    orderName?: string;
    email?: string; // Optional: pass email directly to avoid lookup issues
}

interface PaymentFailureData {
    orderId?: string;
    failReason?: string;
    reason?: string;
    isRecurring?: boolean;
    plan?: string;
    amount?: number;
    failureCount?: number;
    nextRetryDate?: string;
    isSuspended?: boolean;
    email?: string; // Optional: pass email directly
}

interface SubscriptionCancelData {
    plan: string;
    cancelledAt: string;
    effectiveUntil?: string;
    email?: string; // Optional: pass email directly
}

interface SubscriptionChangeData {
    oldPlan: string;
    newPlan: string;
    amount: number;
    effectiveAt: string;
}

// Nova AI logo for email templates - using www subdomain (no redirect)
const NOVA_LOGO_URL = "https://www.nova-ai.work/nova-logo.png";

// Cached logo data for CID embedding
let cachedLogoBase64: string | null = null;
let cachedLogoContentType: string = "image/png";

// Fetch and cache logo for CID embedding
async function getLogoAttachment(): Promise<{
    content: string;
    filename: string;
    contentType: string;
} | null> {
    if (cachedLogoBase64) {
        return {
            content: cachedLogoBase64,
            filename: "nova-logo.png",
            contentType: cachedLogoContentType,
        };
    }

    const logoUrl = process.env.EMAIL_LOGO_URL || NOVA_LOGO_URL;
    
    try {
        console.log("[email] Fetching logo for CID embedding from:", logoUrl);
        const response = await fetch(logoUrl, {
            headers: { Accept: "image/*" },
        });
        
        if (response.ok) {
            const arrayBuffer = await response.arrayBuffer();
            cachedLogoBase64 = Buffer.from(arrayBuffer).toString("base64");
            cachedLogoContentType = response.headers.get("content-type") || "image/png";
            console.log("[email] Logo cached for CID embedding, size:", cachedLogoBase64.length, "bytes");
            return {
                content: cachedLogoBase64,
                filename: "nova-logo.png",
                contentType: cachedLogoContentType,
            };
        }
    } catch (err) {
        console.warn("[email] Failed to fetch logo for CID embedding:", err);
    }
    
    return null;
}

// Helper function to get base URL and logo (uses CID reference for email)
async function getEmailAssetsAsync(): Promise<{
    baseUrl: string;
    logoUrl: string;
}> {
    const baseUrl = (
        process.env.NEXT_PUBLIC_BASE_URL ||
        process.env.NEXT_PUBLIC_APP_URL ||
        process.env.BASE_URL ||
        "https://www.nova-ai.work"
    ).replace(/\/$/, "");

    // Use direct URL - CID embedding was causing issues with some email clients
    const logoUrl = process.env.EMAIL_LOGO_URL || NOVA_LOGO_URL;
    console.log("[email] Using direct logo URL:", logoUrl);
    
    return { baseUrl, logoUrl };
}

// Sync version for backwards compatibility (uses direct URL)
function getEmailAssets() {
    const baseUrl = (
        process.env.NEXT_PUBLIC_BASE_URL ||
        process.env.NEXT_PUBLIC_APP_URL ||
        process.env.BASE_URL ||
        "https://www.nova-ai.work"
    ).replace(/\/$/, "");

    // Use direct URL
    const logoUrl = process.env.EMAIL_LOGO_URL || NOVA_LOGO_URL;

    return { baseUrl, logoUrl };
}

// Plan display names
function getPlanDisplayName(plan: string): string {
    const names: Record<string, string> = {
        free: "Free",
        basic: "Basic",
        plus: "Plus",
        pro: "Pro",
    };
    return names[plan?.toLowerCase()] || plan || "Unknown";
}

// Send payment receipt email
export async function sendPaymentReceipt(
    userId: string,
    data: PaymentReceiptData,
) {
    try {
        // Use email from data if provided, otherwise look it up
        const userEmail = data.email || (await getUserEmail(userId));

        if (!userEmail) {
            console.error("No email found for user:", userId);
            return;
        }

        console.log(
            `📧 Sending payment receipt to: ${userEmail} for user: ${userId}`,
        );

        const { logoUrl } = await getEmailAssetsAsync();
        const planName = getPlanDisplayName(data.plan || "");
        const formattedDate = new Date(data.approvedAt).toLocaleString(
            "ko-KR",
            {
                year: "numeric",
                month: "long",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
            },
        );

        const subject = "[Nova AI] 결제가 완료되었습니다";
        const text = `안녕하세요,

Nova AI 결제가 완료되었습니다.

주문번호: ${data.orderId}
상품명: ${data.orderName || `Nova AI ${planName} 요금제`}
결제금액: ${data.amount.toLocaleString()}원
결제수단: ${data.method}
결제일시: ${formattedDate}

감사합니다.
Nova AI 팀`;

        const html = `<!doctype html>
<html lang="ko">
<body style="margin:0; padding:0; background:#f9fafb; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#f9fafb;">
    <tr>
        <td align="center" style="padding:40px 16px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px; border-radius:8px; box-shadow:0 2px 8px rgba(0,0,0,0.08); overflow:hidden;">
            
            <!-- Logo (dark header) -->
            <tr>
            <td style="padding:24px 32px; background:#111827; border-radius:8px 8px 0 0;">
                <img src="${logoUrl}" alt="Nova AI" height="40" style="display:block; width:auto; height:40px;" />
            </td>
            </tr>

            <!-- Content area -->
            <tr>
            <td style="background:#ffffff;">
            <table width="100%" cellpadding="0" cellspacing="0">

            <!-- Success Icon -->
            <tr>
            <td style="padding:24px 32px 16px;">
                <div style="width:56px; height:56px; background:#dcfce7; border-radius:50%; display:flex; align-items:center; justify-content:center;">
                    <span style="font-size:28px;">✓</span>
                </div>
            </td>
            </tr>

            <!-- Title -->
            <tr>
            <td style="padding:0 32px 16px;">
                <h1 style="margin:0; font-size:24px; font-weight:700; color:#111827; line-height:1.3;">
                결제가 완료되었습니다
                </h1>
            </td>
            </tr>

            <!-- Description -->
            <tr>
            <td style="padding:0 32px 24px;">
                <p style="margin:0; font-size:15px; line-height:1.6; color:#374151;">
                Nova AI 결제가 정상적으로 처리되었습니다.<br/>
                아래에서 결제 내역을 확인하세요.
                </p>
            </td>
            </tr>

            <!-- Payment Details Box -->
            <tr>
            <td style="padding:0 32px 24px;">
                <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb; border-radius:8px; border:1px solid #e5e7eb;">
                <tr>
                    <td style="padding:16px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                        <tr>
                        <td style="padding:8px 0; border-bottom:1px solid #e5e7eb;">
                            <span style="font-size:13px; color:#6b7280;">주문번호</span><br/>
                            <span style="font-size:14px; color:#111827; font-weight:500;">${data.orderId}</span>
                        </td>
                        </tr>
                        <tr>
                        <td style="padding:8px 0; border-bottom:1px solid #e5e7eb;">
                            <span style="font-size:13px; color:#6b7280;">상품명</span><br/>
                            <span style="font-size:14px; color:#111827; font-weight:500;">${data.orderName || `Nova AI ${planName} 요금제`}</span>
                        </td>
                        </tr>
                        <tr>
                        <td style="padding:8px 0; border-bottom:1px solid #e5e7eb;">
                            <span style="font-size:13px; color:#6b7280;">결제금액</span><br/>
                            <span style="font-size:18px; color:#111827; font-weight:700;">${data.amount.toLocaleString()}원</span>
                        </td>
                        </tr>
                        <tr>
                        <td style="padding:8px 0; border-bottom:1px solid #e5e7eb;">
                            <span style="font-size:13px; color:#6b7280;">결제수단</span><br/>
                            <span style="font-size:14px; color:#111827; font-weight:500;">${data.method}</span>
                        </td>
                        </tr>
                        <tr>
                        <td style="padding:8px 0;">
                            <span style="font-size:13px; color:#6b7280;">결제일시</span><br/>
                            <span style="font-size:14px; color:#111827; font-weight:500;">${formattedDate}</span>
                        </td>
                        </tr>
                    </table>
                    </td>
                </tr>
                </table>
            </td>
            </tr>

            <!-- CTA Button -->
            <tr>
            <td style="padding:0 32px 32px;">
                <a href="https://www.nova-ai.work/profile" style="display:inline-block; padding:14px 32px; border-radius:8px; background:#3b82f6; color:#ffffff; font-size:15px; font-weight:600; text-decoration:none;">
                마이페이지에서 확인하기
                </a>
            </td>
            </tr>

            <!-- Footer -->
            <tr>
            <td style="padding:24px 32px; background:#f9fafb; border-top:1px solid #e5e7eb;">
                <p style="margin:0 0 4px; font-size:12px; color:#6b7280; line-height:1.5;">
                Nova AI Team
                </p>
                <p style="margin:0; font-size:11px; color:#9ca3af; line-height:1.5;">
                ※ 본 메일은 발신 전용이므로, 회신 내용을 확인할 수 없습니다.
                </p>
            </td>
            </tr>

        </table>
        </td>
    </tr>
    </table>
</body>
</html>`;

        await sendEmail({ to: userEmail, subject, text, html });
        console.log("✅ Payment receipt email sent to:", userEmail);
    } catch (error) {
        console.error("Error sending payment receipt:", error);
    }
}

// Send payment failure notification
export async function sendPaymentFailureNotification(
    userId: string,
    data: PaymentFailureData,
) {
    try {
        // Use email from data if provided, otherwise look it up
        const userEmail = data.email || (await getUserEmail(userId));

        if (!userEmail) {
            console.error("No email found for user:", userId);
            return;
        }

        console.log(
            `📧 Sending payment failure notification to: ${userEmail} for user: ${userId}`,
        );

        const { logoUrl } = await getEmailAssetsAsync();
        const planName = getPlanDisplayName(data.plan || "");
        const failReason = data.failReason || data.reason || "알 수 없는 오류";

        // Build retry/suspension message
        let statusMessage = "";
        if (data.isSuspended) {
            statusMessage =
                "결제가 3회 연속 실패하여 구독이 일시 중지되었습니다.";
        } else if (data.failureCount && data.nextRetryDate) {
            const retryDateStr = new Date(
                data.nextRetryDate,
            ).toLocaleDateString("ko-KR", {
                month: "long",
                day: "numeric",
            });
            statusMessage = `결제 실패 ${data.failureCount}회 / 3회. ${retryDateStr}에 재시도 예정입니다.`;
        } else if (data.isRecurring) {
            statusMessage = "구독 서비스가 일시 중지되었습니다.";
        }

        const subject = `[Nova AI] ${data.isRecurring ? "정기 " : ""}결제 실패 안내`;
        const text = `안녕하세요,

${data.isRecurring ? "정기 결제" : "결제"}가 실패했습니다.

${data.orderId ? `주문번호: ${data.orderId}` : ""}
실패 사유: ${failReason}
${statusMessage}

${
    data.isRecurring
        ? "구독이 일시 중지되었습니다. 결제 정보를 업데이트해주세요."
        : "다시 시도하시거나 다른 결제 수단을 이용해주세요."
}

문의사항이 있으시면 고객센터로 연락주세요.

Nova AI 팀`;

        const html = `<!doctype html>
<html lang="ko">
<body style="margin:0; padding:0; background:#f9fafb; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#f9fafb;">
    <tr>
        <td align="center" style="padding:40px 16px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px; border-radius:8px; box-shadow:0 2px 8px rgba(0,0,0,0.08); overflow:hidden;">
            
            <!-- Logo (dark header) -->
            <tr>
            <td style="padding:24px 32px; background:#111827; border-radius:8px 8px 0 0;">
                <img src="${logoUrl}" alt="Nova AI" height="40" style="display:block; width:auto; height:40px;" />
            </td>
            </tr>

            <!-- Content area -->
            <tr>
            <td style="background:#ffffff;">
            <table width="100%" cellpadding="0" cellspacing="0">

            <!-- Error Icon -->
            <tr>
            <td style="padding:24px 32px 16px;">
                <div style="width:56px; height:56px; background:#fee2e2; border-radius:50%; display:flex; align-items:center; justify-content:center;">
                    <span style="font-size:28px;">${data.isSuspended ? "⚠️" : "✕"}</span>
                </div>
            </td>
            </tr>

            <!-- Title -->
            <tr>
            <td style="padding:0 32px 16px;">
                <h1 style="margin:0; font-size:24px; font-weight:700; color:#111827; line-height:1.3;">
                ${data.isSuspended ? "구독이 일시 중지되었습니다" : (data.isRecurring ? "정기 결제" : "결제") + "에 실패했습니다"}
                </h1>
            </td>
            </tr>

            <!-- Description -->
            <tr>
            <td style="padding:0 32px 24px;">
                <p style="margin:0; font-size:15px; line-height:1.6; color:#374151;">
                ${
                    data.isSuspended
                        ? "결제가 3회 연속 실패하여 구독이 일시 중지되었습니다.<br/>계속 사용하시려면 결제 수단을 업데이트해주세요."
                        : data.isRecurring
                          ? "등록된 카드로 정기 결제를 진행하지 못했습니다."
                          : "결제 처리 중 문제가 발생했습니다.<br/>다시 시도해주세요."
                }
                </p>
            </td>
            </tr>

            <!-- Error Details Box -->
            <tr>
            <td style="padding:0 32px 24px;">
                <table width="100%" cellpadding="0" cellspacing="0" style="background:#fef2f2; border-radius:8px; border:1px solid #fecaca;">
                <tr>
                    <td style="padding:16px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                        ${
                            data.orderId
                                ? `
                        <tr>
                        <td style="padding:4px 0;">
                            <span style="font-size:13px; color:#991b1b;">주문번호: ${data.orderId}</span>
                        </td>
                        </tr>
                        `
                                : ""
                        }
                        <tr>
                        <td style="padding:4px 0;">
                            <span style="font-size:13px; color:#991b1b;">실패 사유: ${failReason}</span>
                        </td>
                        </tr>
                        ${
                            data.amount
                                ? `
                        <tr>
                        <td style="padding:4px 0;">
                            <span style="font-size:13px; color:#991b1b;">결제 시도 금액: ${data.amount.toLocaleString()}원</span>
                        </td>
                        </tr>
                        `
                                : ""
                        }
                        ${
                            statusMessage
                                ? `
                        <tr>
                        <td style="padding:8px 0 4px;">
                            <span style="font-size:13px; font-weight:600; color:#991b1b;">${statusMessage}</span>
                        </td>
                        </tr>
                        `
                                : ""
                        }
                    </table>
                    </td>
                </tr>
                </table>
            </td>
            </tr>

            <!-- CTA Button -->
            <tr>
            <td style="padding:0 32px 32px;">
                <a href="https://www.nova-ai.work/profile?tab=subscription" style="display:inline-block; padding:14px 32px; border-radius:8px; background:#3b82f6; color:#ffffff; font-size:15px; font-weight:600; text-decoration:none;">
                ${data.isSuspended ? "결제 수단 업데이트하기" : data.isRecurring ? "결제 수단 변경하기" : "다시 결제하기"}
                </a>
            </td>
            </tr>

            <!-- Footer -->
            <tr>
            <td style="padding:24px 32px; background:#f9fafb; border-top:1px solid #e5e7eb;">
                <p style="margin:0 0 4px; font-size:12px; color:#6b7280; line-height:1.5;">
                Nova AI Team
                </p>
                <p style="margin:0; font-size:11px; color:#9ca3af; line-height:1.5;">
                ※ 문의사항이 있으시면 support@nova-ai.work로 연락주세요.
                </p>
            </td>
            </tr>

        </table>
        </td>
    </tr>
    </table>
</body>
</html>`;

        await sendEmail({ to: userEmail, subject, text, html });
        console.log("✅ Payment failure notification sent to:", userEmail);
    } catch (error) {
        console.error("Error sending payment failure notification:", error);
    }
}

// Send subscription renewal reminder (3 days before)
export async function sendRenewalReminder(
    userId: string,
    amount: number,
    nextBillingDate: string,
    plan?: string,
) {
    try {
        const userEmail = await getUserEmail(userId);

        if (!userEmail) {
            return;
        }

        const { logoUrl } = await getEmailAssetsAsync();
        const planName = getPlanDisplayName(plan || "");
        const formattedDate = new Date(nextBillingDate).toLocaleDateString(
            "ko-KR",
            {
                year: "numeric",
                month: "long",
                day: "numeric",
            },
        );

        const subject = "[Nova AI] 구독 갱신 안내";
        const text = `안녕하세요,

Nova AI 구독 갱신 안내입니다.

다음 결제 예정일: ${formattedDate}
결제 예정 금액: ${amount.toLocaleString()}원

등록된 카드로 자동 결제됩니다.

Nova AI 팀`;

        const html = `<!doctype html>
<html lang="ko">
<body style="margin:0; padding:0; background:#f9fafb; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#f9fafb;">
    <tr>
        <td align="center" style="padding:40px 16px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px; border-radius:8px; box-shadow:0 2px 8px rgba(0,0,0,0.08); overflow:hidden;">
            
            <!-- Logo (dark header) -->
            <tr>
            <td style="padding:24px 32px; background:#111827; border-radius:8px 8px 0 0;">
                <img src="${logoUrl}" alt="Nova AI" height="40" style="display:block; width:auto; height:40px;" />
            </td>
            </tr>

            <!-- Content area -->
            <tr>
            <td style="background:#ffffff;">
            <table width="100%" cellpadding="0" cellspacing="0">

            <!-- Calendar Icon -->
            <tr>
            <td style="padding:24px 32px 16px;">
                <div style="width:56px; height:56px; background:#dbeafe; border-radius:50%; display:flex; align-items:center; justify-content:center;">
                    <span style="font-size:28px;">📅</span>
                </div>
            </td>
            </tr>

            <!-- Title -->
            <tr>
            <td style="padding:0 32px 16px;">
                <h1 style="margin:0; font-size:24px; font-weight:700; color:#111827; line-height:1.3;">
                구독 갱신 안내
                </h1>
            </td>
            </tr>

            <!-- Description -->
            <tr>
            <td style="padding:0 32px 24px;">
                <p style="margin:0; font-size:15px; line-height:1.6; color:#374151;">
                Nova AI ${planName} 구독이 곧 갱신됩니다.<br/>
                등록된 카드로 자동 결제가 진행됩니다.
                </p>
            </td>
            </tr>

            <!-- Renewal Details Box -->
            <tr>
            <td style="padding:0 32px 24px;">
                <table width="100%" cellpadding="0" cellspacing="0" style="background:#eff6ff; border-radius:8px; border:1px solid #bfdbfe;">
                <tr>
                    <td style="padding:16px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                        <tr>
                        <td style="padding:8px 0; border-bottom:1px solid #bfdbfe;">
                            <span style="font-size:13px; color:#1e40af;">요금제</span><br/>
                            <span style="font-size:14px; color:#1e3a8a; font-weight:500;">${planName}</span>
                        </td>
                        </tr>
                        <tr>
                        <td style="padding:8px 0; border-bottom:1px solid #bfdbfe;">
                            <span style="font-size:13px; color:#1e40af;">결제 예정일</span><br/>
                            <span style="font-size:14px; color:#1e3a8a; font-weight:500;">${formattedDate}</span>
                        </td>
                        </tr>
                        <tr>
                        <td style="padding:8px 0;">
                            <span style="font-size:13px; color:#1e40af;">결제 예정 금액</span><br/>
                            <span style="font-size:18px; color:#1e3a8a; font-weight:700;">${amount.toLocaleString()}원</span>
                        </td>
                        </tr>
                    </table>
                    </td>
                </tr>
                </table>
            </td>
            </tr>

            <!-- Info -->
            <tr>
            <td style="padding:0 32px 24px;">
                <p style="margin:0; font-size:13px; line-height:1.6; color:#6b7280;">
                구독을 계속하지 않으시려면 결제일 전에 구독을 취소해주세요.
                </p>
            </td>
            </tr>

            <!-- CTA Button -->
            <tr>
            <td style="padding:0 32px 32px;">
                <a href="https://www.nova-ai.work/profile?tab=subscription" style="display:inline-block; padding:14px 32px; border-radius:8px; background:#3b82f6; color:#ffffff; font-size:15px; font-weight:600; text-decoration:none;">
                구독 관리하기
                </a>
            </td>
            </tr>

            <!-- Footer -->
            <tr>
            <td style="padding:24px 32px; background:#f9fafb; border-top:1px solid #e5e7eb;">
                <p style="margin:0 0 4px; font-size:12px; color:#6b7280; line-height:1.5;">
                Nova AI Team
                </p>
                <p style="margin:0; font-size:11px; color:#9ca3af; line-height:1.5;">
                ※ 본 메일은 발신 전용이므로, 회신 내용을 확인할 수 없습니다.
                </p>
            </td>
            </tr>

        </table>
        </td>
    </tr>
    </table>
</body>
</html>`;

        await sendEmail({ to: userEmail, subject, text, html });
        console.log("✅ Renewal reminder sent to:", userEmail);
    } catch (error) {
        console.error("Error sending renewal reminder:", error);
    }
}

// Send subscription cancellation notification
export async function sendSubscriptionCancelledEmail(
    userId: string,
    data: SubscriptionCancelData,
) {
    try {
        // Use email from data if provided, otherwise look it up
        const userEmail = data.email || (await getUserEmail(userId));

        if (!userEmail) {
            console.error("No email found for user:", userId);
            return;
        }

        console.log(
            `📧 Sending subscription cancelled email to: ${userEmail} for user: ${userId}`,
        );

        const { logoUrl } = await getEmailAssetsAsync();
        const planName = getPlanDisplayName(data.plan);
        const cancelledDate = new Date(data.cancelledAt).toLocaleDateString(
            "ko-KR",
            {
                year: "numeric",
                month: "long",
                day: "numeric",
            },
        );
        const effectiveDate = data.effectiveUntil
            ? new Date(data.effectiveUntil).toLocaleDateString("ko-KR", {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
              })
            : cancelledDate;

        const subject = "[Nova AI] 구독이 취소되었습니다";
        const text = `안녕하세요,

Nova AI ${planName} 구독이 취소되었습니다.

취소일: ${cancelledDate}
${data.effectiveUntil ? `서비스 이용 가능일: ${effectiveDate}까지` : ""}

언제든지 다시 구독하실 수 있습니다.
Nova AI를 이용해주셔서 감사합니다.

Nova AI 팀`;

        const html = `<!doctype html>
<html lang="ko">
<body style="margin:0; padding:0; background:#f9fafb; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#f9fafb;">
    <tr>
        <td align="center" style="padding:40px 16px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px; border-radius:8px; box-shadow:0 2px 8px rgba(0,0,0,0.08); overflow:hidden;">
            
            <!-- Logo (dark header) -->
            <tr>
            <td style="padding:24px 32px; background:#111827; border-radius:8px 8px 0 0;">
                <img src="${logoUrl}" alt="Nova AI" height="40" style="display:block; width:auto; height:40px;" />
            </td>
            </tr>

            <!-- Content area -->
            <tr>
            <td style="background:#ffffff;">
            <table width="100%" cellpadding="0" cellspacing="0">

            <!-- Icon -->
            <tr>
            <td style="padding:24px 32px 16px;">
                <div style="width:56px; height:56px; background:#f3f4f6; border-radius:50%; display:flex; align-items:center; justify-content:center;">
                    <span style="font-size:28px;">👋</span>
                </div>
            </td>
            </tr>

            <!-- Title -->
            <tr>
            <td style="padding:0 32px 16px;">
                <h1 style="margin:0; font-size:24px; font-weight:700; color:#111827; line-height:1.3;">
                구독이 취소되었습니다
                </h1>
            </td>
            </tr>

            <!-- Description -->
            <tr>
            <td style="padding:0 32px 24px;">
                <p style="margin:0; font-size:15px; line-height:1.6; color:#374151;">
                Nova AI ${planName} 구독이 취소되었습니다.<br/>
                ${
                    data.effectiveUntil
                        ? `${effectiveDate}까지 서비스를 계속 이용하실 수 있습니다.`
                        : "더 이상 정기 결제가 진행되지 않습니다."
                }
                </p>
            </td>
            </tr>

            <!-- Details Box -->
            <tr>
            <td style="padding:0 32px 24px;">
                <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb; border-radius:8px; border:1px solid #e5e7eb;">
                <tr>
                    <td style="padding:16px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                        <tr>
                        <td style="padding:8px 0; border-bottom:1px solid #e5e7eb;">
                            <span style="font-size:13px; color:#6b7280;">취소된 요금제</span><br/>
                            <span style="font-size:14px; color:#111827; font-weight:500;">${planName}</span>
                        </td>
                        </tr>
                        <tr>
                        <td style="padding:8px 0;${data.effectiveUntil ? " border-bottom:1px solid #e5e7eb;" : ""}">
                            <span style="font-size:13px; color:#6b7280;">취소일</span><br/>
                            <span style="font-size:14px; color:#111827; font-weight:500;">${cancelledDate}</span>
                        </td>
                        </tr>
                        ${
                            data.effectiveUntil
                                ? `
                        <tr>
                        <td style="padding:8px 0;">
                            <span style="font-size:13px; color:#6b7280;">서비스 이용 가능일</span><br/>
                            <span style="font-size:14px; color:#111827; font-weight:500;">${effectiveDate}까지</span>
                        </td>
                        </tr>
                        `
                                : ""
                        }
                    </table>
                    </td>
                </tr>
                </table>
            </td>
            </tr>

            <!-- Message -->
            <tr>
            <td style="padding:0 32px 24px;">
                <p style="margin:0; font-size:14px; line-height:1.6; color:#6b7280;">
                Nova AI를 이용해주셔서 감사합니다.<br/>
                언제든지 다시 구독하실 수 있습니다.
                </p>
            </td>
            </tr>

            <!-- CTA Button -->
            <tr>
            <td style="padding:0 32px 32px;">
                <a href="https://www.nova-ai.work/#pricing" style="display:inline-block; padding:14px 32px; border-radius:8px; background:#3b82f6; color:#ffffff; font-size:15px; font-weight:600; text-decoration:none;">
                다시 구독하기
                </a>
            </td>
            </tr>

            <!-- Footer -->
            <tr>
            <td style="padding:24px 32px; background:#f9fafb; border-top:1px solid #e5e7eb;">
                <p style="margin:0 0 4px; font-size:12px; color:#6b7280; line-height:1.5;">
                Nova AI Team
                </p>
                <p style="margin:0; font-size:11px; color:#9ca3af; line-height:1.5;">
                ※ 본 메일은 발신 전용이므로, 회신 내용을 확인할 수 없습니다.
                </p>
            </td>
            </tr>

        </table>
        </td>
    </tr>
    </table>
</body>
</html>`;

        await sendEmail({ to: userEmail, subject, text, html });
        console.log("✅ Subscription cancelled email sent to:", userEmail);
    } catch (error) {
        console.error("Error sending subscription cancelled email:", error);
    }
}

// Send subscription change notification (upgrade/downgrade)
export async function sendSubscriptionChangedEmail(
    userId: string,
    data: SubscriptionChangeData,
) {
    try {
        const userEmail = await getUserEmail(userId);

        if (!userEmail) {
            console.error("No email found for user:", userId);
            return;
        }

        const { logoUrl } = await getEmailAssetsAsync();
        const oldPlanName = getPlanDisplayName(data.oldPlan);
        const newPlanName = getPlanDisplayName(data.newPlan);
        const effectiveDate = new Date(data.effectiveAt).toLocaleDateString(
            "ko-KR",
            {
                year: "numeric",
                month: "long",
                day: "numeric",
            },
        );

        const isUpgrade =
            ["pro", "plus", "basic"].indexOf(data.newPlan.toLowerCase()) <
            ["pro", "plus", "basic"].indexOf(data.oldPlan.toLowerCase());

        const subject = `[Nova AI] 요금제가 ${isUpgrade ? "업그레이드" : "변경"}되었습니다`;
        const text = `안녕하세요,

Nova AI 요금제가 변경되었습니다.

이전 요금제: ${oldPlanName}
새 요금제: ${newPlanName}
결제 금액: ${data.amount.toLocaleString()}원
적용일: ${effectiveDate}

감사합니다.
Nova AI 팀`;

        const html = `<!doctype html>
<html lang="ko">
<body style="margin:0; padding:0; background:#f9fafb; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#f9fafb;">
    <tr>
        <td align="center" style="padding:40px 16px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px; border-radius:8px; box-shadow:0 2px 8px rgba(0,0,0,0.08); overflow:hidden;">
            
            <!-- Logo (dark header) -->
            <tr>
            <td style="padding:24px 32px; background:#111827; border-radius:8px 8px 0 0;">
                <img src="${logoUrl}" alt="Nova AI" height="40" style="display:block; width:auto; height:40px;" />
            </td>
            </tr>

            <!-- Content area -->
            <tr>
            <td style="background:#ffffff;">
            <table width="100%" cellpadding="0" cellspacing="0">

            <!-- Icon -->
            <tr>
            <td style="padding:24px 32px 16px;">
                <div style="width:56px; height:56px; background:${isUpgrade ? "#dcfce7" : "#dbeafe"}; border-radius:50%; display:flex; align-items:center; justify-content:center;">
                    <span style="font-size:28px;">${isUpgrade ? "🚀" : "📦"}</span>
                </div>
            </td>
            </tr>

            <!-- Title -->
            <tr>
            <td style="padding:0 32px 16px;">
                <h1 style="margin:0; font-size:24px; font-weight:700; color:#111827; line-height:1.3;">
                요금제가 ${isUpgrade ? "업그레이드" : "변경"}되었습니다
                </h1>
            </td>
            </tr>

            <!-- Description -->
            <tr>
            <td style="padding:0 32px 24px;">
                <p style="margin:0; font-size:15px; line-height:1.6; color:#374151;">
                ${
                    isUpgrade
                        ? `축하합니다! ${newPlanName} 요금제로 업그레이드되었습니다.<br/>더 많은 기능을 이용하실 수 있습니다.`
                        : `${newPlanName} 요금제로 변경되었습니다.`
                }
                </p>
            </td>
            </tr>

            <!-- Change Details Box -->
            <tr>
            <td style="padding:0 32px 24px;">
                <table width="100%" cellpadding="0" cellspacing="0" style="background:${isUpgrade ? "#f0fdf4" : "#eff6ff"}; border-radius:8px; border:1px solid ${isUpgrade ? "#bbf7d0" : "#bfdbfe"};">
                <tr>
                    <td style="padding:16px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                        <tr>
                        <td style="padding:8px 0; border-bottom:1px solid ${isUpgrade ? "#bbf7d0" : "#bfdbfe"};">
                            <span style="font-size:13px; color:#6b7280;">이전 요금제</span><br/>
                            <span style="font-size:14px; color:#111827; font-weight:500; text-decoration:line-through;">${oldPlanName}</span>
                        </td>
                        </tr>
                        <tr>
                        <td style="padding:8px 0; border-bottom:1px solid ${isUpgrade ? "#bbf7d0" : "#bfdbfe"};">
                            <span style="font-size:13px; color:#6b7280;">새 요금제</span><br/>
                            <span style="font-size:16px; color:${isUpgrade ? "#16a34a" : "#2563eb"}; font-weight:700;">${newPlanName}</span>
                        </td>
                        </tr>
                        <tr>
                        <td style="padding:8px 0; border-bottom:1px solid ${isUpgrade ? "#bbf7d0" : "#bfdbfe"};">
                            <span style="font-size:13px; color:#6b7280;">결제 금액</span><br/>
                            <span style="font-size:18px; color:#111827; font-weight:700;">${data.amount.toLocaleString()}원</span>
                        </td>
                        </tr>
                        <tr>
                        <td style="padding:8px 0;">
                            <span style="font-size:13px; color:#6b7280;">적용일</span><br/>
                            <span style="font-size:14px; color:#111827; font-weight:500;">${effectiveDate}</span>
                        </td>
                        </tr>
                    </table>
                    </td>
                </tr>
                </table>
            </td>
            </tr>

            <!-- CTA Button -->
            <tr>
            <td style="padding:0 32px 32px;">
                <a href="https://www.nova-ai.work/profile?tab=subscription" style="display:inline-block; padding:14px 32px; border-radius:8px; background:#3b82f6; color:#ffffff; font-size:15px; font-weight:600; text-decoration:none;">
                마이페이지에서 확인하기
                </a>
            </td>
            </tr>

            <!-- Footer -->
            <tr>
            <td style="padding:24px 32px; background:#f9fafb; border-top:1px solid #e5e7eb;">
                <p style="margin:0 0 4px; font-size:12px; color:#6b7280; line-height:1.5;">
                Nova AI Team
                </p>
                <p style="margin:0; font-size:11px; color:#9ca3af; line-height:1.5;">
                ※ 본 메일은 발신 전용이므로, 회신 내용을 확인할 수 없습니다.
                </p>
            </td>
            </tr>

        </table>
        </td>
    </tr>
    </table>
</body>
</html>`;

        await sendEmail({ to: userEmail, subject, text, html });
        console.log("✅ Subscription changed email sent to:", userEmail);
    } catch (error) {
        console.error("Error sending subscription changed email:", error);
    }
}

// Core email sending function
async function sendEmail({
    to,
    subject,
    text,
    html,
}: {
    to: string;
    subject: string;
    text: string;
    html?: string;
}) {
    // Option 1: Use email API service (Resend, SendGrid, etc.)
    if (process.env.RESEND_API_KEY) {
        const result = await sendViaResend(to, subject, text, html);
        // persist a copy in dev temp log as well
        try {
            const fs = await import("fs");
            const os = await import("os");
            const path = await import("path");
            const tmp = path.join(os.tmpdir(), "formulite-sent-emails.log");
            const entry = {
                time: new Date().toISOString(),
                provider: "resend",
                to,
                subject,
                text: text?.slice(0, 10000) || "",
                html: html ? html.slice(0, 2000) : null,
                result: typeof result === "object" ? result : String(result),
            };
            fs.appendFileSync(tmp, JSON.stringify(entry) + "\n");
            console.info("[email] persisted sent email to", tmp);
        } catch (err) {
            console.warn("[email] failed to persist sent email", err);
        }
        return result;
    }

    // Option 2: Use mailto (for development/testing)
    console.log("📧 Email (development mode):");
    console.log("To:", to);
    console.log("Subject:", subject);
    console.log("Body:", text);
    if (html) console.log("HTML:", html.slice(0, 1000));

    // Persist dev email to a temporary file for inspection
    try {
        const fs = await import("fs");
        const os = await import("os");
        const path = await import("path");
        const tmp = path.join(os.tmpdir(), "formulite-sent-emails.log");
        const entry = {
            time: new Date().toISOString(),
            provider: "dev_log",
            to,
            subject,
            text: text?.slice(0, 10000) || "",
            html: html ? html.slice(0, 2000) : null,
        };
        fs.appendFileSync(tmp, JSON.stringify(entry) + "\n");
        console.info("[email] persisted dev email to", tmp);
    } catch (err) {
        console.warn("[email] failed to persist dev email", err);
    }
}

// Send via Resend (recommended)
async function sendViaResend(
    to: string,
    subject: string,
    text: string,
    html?: string,
) {
    const fromAddress =
        process.env.EMAIL_FROM || "Nova AI <noreply@formulite.ai>";

    const payload: any = {
        from: fromAddress,
        to: [to],
        subject,
        text,
    };

    if (html) {
        payload.html = html;
    }

    const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
    });

    // If the provider returns a non-OK status, capture any body text for diagnostics
    if (!response.ok) {
        let errorBody: string | null = null;
        try {
            errorBody = await response.text();
        } catch (err) {
            // ignore
        }
        const msg = `Resend returned ${response.status} ${
            response.statusText
        }: ${errorBody || "<no body>"}`;
        console.error("[email] resend non-ok response:", msg);
        throw new Error(msg);
    }

    // Try to parse JSON if present, but be tolerant of empty/non-JSON responses
    try {
        const raw = await response.text();
        if (!raw) {
            // No body; return a minimal success object
            return { ok: true, status: response.status };
        }

        try {
            return JSON.parse(raw);
        } catch (err) {
            // Response not JSON; return the raw text for debugging
            console.warn(
                "[email] Resend returned non-JSON response, returning text:",
                raw.slice(0, 1000),
            );
            return { ok: true, status: response.status, text: raw };
        }
    } catch (error) {
        console.error("[email] failed to read resend response:", error);
        throw error;
    }
}

// Send password reset link email (server-side should call this with a generated link)
export async function sendPasswordResetEmailToUser(
    to: string,
    resetLink: string,
) {
    try {
        const subject = "[Nova AI] 비밀번호 재설정 안내";
        const text = `안녕하세요,

Nova AI 사용자분께서 비밀번호 재설정을 요청하셨습니다.\n아래 링크를 클릭하여 새 비밀번호를 설정하세요.\n링크는 보안을 위해 1시간의 유효기간이 있습니다.
${resetLink}

위 링크를 요청하지 않으셨다면 이 메일을 무시하셔도 됩니다.

감사합니다.
Nova AI 팀`.trim();

        const { logoUrl } = await getEmailAssetsAsync();

        const html = `<!doctype html>
                        <html lang="ko">
                            <body style="margin:0; padding:0; background:#f9fafb; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;">
                                <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#f9fafb;">
                                <tr>
                                    <td align="center" style="padding:40px 16px;">
                                    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px; border-radius:8px; box-shadow:0 2px 8px rgba(0,0,0,0.08); overflow:hidden;">
                                        
                                        <!-- Logo (dark header) -->
                                        <tr>
                                        <td style="padding:24px 32px; background:#111827; border-radius:8px 8px 0 0;">
                                            <img
                                            src="${logoUrl}"
                                            alt="Nova AI"
                                            height="40"
                                            style="display:block; width:auto; height:40px;"
                                            />
                                        </td>
                                        </tr>

                                        <!-- Content area -->
                                        <tr>
                                        <td style="background:#ffffff;">
                                        <table width="100%" cellpadding="0" cellspacing="0">

                                        <!-- Title -->
                                        <tr>
                                        <td style="padding:24px 32px 16px;">
                                            <h1 style="margin:0; font-size:24px; font-weight:700; color:#111827; line-height:1.3;">
                                            비밀번호 재설정
                                            </h1>
                                        </td>
                                        </tr>

                                        <!-- Description -->
                                        <tr>
                                        <td style="padding:0 32px 24px;">
                                            <p style="margin:0; font-size:15px; line-height:1.6; color:#374151;">
                                            Nova AI 사용자분께서 비밀번호 재설정을 요청하셨습니다.
                                            <br/>
                                            아래 버튼을 눌러 새 비밀번호를 설정하세요.
                                            <br/>
                                            링크는 보안을 위해 1시간의 유효기간이 있습니다.
                                            <br/>
                                            비밀번호 재설정을 신청하지 않으셨다면 무시하셔도 됩니다.
                                            </p>
                                        </td>
                                        </tr>

                                        <!-- CTA Button -->
                                        <tr>
                                        <td style="padding:0 32px 24px;">
                                            <a
                                            href="${resetLink}"
                                            style="
                                                display:inline-block;
                                                padding:14px 32px;
                                                border-radius:8px;
                                                background:#3b82f6;
                                                color:#ffffff;
                                                font-size:15px;
                                                font-weight:600;
                                                text-decoration:none;
                                            "
                                            >
                                            비밀번호 재설정
                                            </a>
                                        </td>
                                        </tr>

                                        <!-- Fallback Link -->
                                        <tr>
                                        <td style="padding:0 32px 32px;">
                                            <p style="margin:0 0 8px; font-size:13px; color:#6b7280;">
                                            버튼이 작동하지 않으면 아래 링크를 사용하세요
                                            </p>
                                            <p style="margin:0; font-size:13px; word-break:break-all;">
                                            <a href="${resetLink}" style="color:#3b82f6; text-decoration:none;">
                                                ${resetLink}
                                            </a>
                                            </p>
                                        </td>
                                        </tr>

                                        </table>
                                        </td>
                                        </tr>

                                        <!-- Footer -->
                                        <tr>
                                        <td style="padding:24px 32px; background:#f9fafb; border-top:1px solid #e5e7eb;">
                                            <p style="margin:0 0 4px; font-size:12px; color:#6b7280; line-height:1.5;">
                                            Nova AI Team
                                            </p>
                                            <p style="margin:0; font-size:11px; color:#9ca3af; line-height:1.5;">
                                            ※ 본 메일은 발신 전용이므로, 회신 내용을 확인할 수 없습니다.
                                            </p>
                                        </td>
                                        </tr>

                                    </table>
                                    </td>
                                </tr>
                                </table>
                            </body>
                        </html>`;

        await sendEmail({
            to,
            subject,
            text,
            html,
        });

        console.log("✅ Password reset email sent to:", to);
    } catch (error) {
        console.error("Error sending password reset email:", error);
        throw error;
    }
}

// Send notification email for password change (security notice)
export async function sendPasswordChangedNotification(to: string) {
    try {
        const subject = "[Nova AI] 비밀번호가 변경되었습니다";
        const text =
            `안녕하세요,\n\n고객님의 계정 비밀번호가 성공적으로 변경되었습니다. 만약 본인이 변경하지 않으셨다면 즉시 고객센터로 연락하거나 비밀번호 재설정을 요청하세요.\n\n감사합니다.\nNova AI 팀`.trim();

        const { logoUrl } = await getEmailAssetsAsync();

        const html = `<!doctype html>
<html lang="ko">
  <body style="margin:0; padding:0; background:#000000; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#000000;">
      <tr>
        <td align="center" style="padding:40px 16px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="max-width:420px; text-align:center;">

            <!-- Logo -->
            <tr>
              <td style="padding-bottom:24px;">
                <img
                  src="${logoUrl}"
                  alt="Nova AI"
                  height="48"
                  style="display:block; margin:0 auto; width:auto; height:48px;"
                />
              </td>
            </tr>

            <!-- Title -->
            <tr>
              <td style="padding-bottom:12px;">
                <h1 style="margin:0; font-size:22px; font-weight:700; color:#ffffff;">
                  비밀번호가 변경되었습니다
                </h1>
              </td>
            </tr>

            <!-- Description -->
            <tr>
              <td style="padding:0 12px 24px;">
                <p style="margin:0; font-size:14px; line-height:1.6; color:#cbd5e1;">
                  고객님의 계정 비밀번호가 성공적으로 변경되었습니다.
                </p>
              </td>
            </tr>

            <!-- Warning Box -->
            <tr>
              <td style="padding:0 12px 32px;">
                <div style="
                  background:#020617;
                  border:1px solid #1e293b;
                  border-radius:8px;
                  padding:14px;
                  font-size:13px;
                  color:#94a3b8;
                  line-height:1.5;
                ">
                  본인이 변경하지 않으셨다면<br/>
                  즉시 고객센터로 연락하거나 비밀번호 재설정을 진행하세요.
                </div>
              </td>
            </tr>

            <!-- Footer -->
            <tr>
              <td>
                <p style="margin:0; font-size:11px; color:#64748b;">
                  Nova AI Team
                </p>
              </td>
            </tr>

          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

        await sendEmail({ to, subject, text, html });
        console.log("✅ Password change notification sent to:", to);
    } catch (error) {
        console.error("Error sending password change notification:", error);
        throw error;
    }
}

// Get user email from Firebase Admin (server-side)
async function getUserEmail(userId: string): Promise<string | null> {
    try {
        const admin = getFirebaseAdmin();

        // First try to get email from Firebase Auth
        try {
            const userRecord = await admin.auth().getUser(userId);
            if (userRecord.email) {
                return userRecord.email;
            }
        } catch (authError) {
            console.warn(
                "Could not get user from Auth, trying Firestore:",
                authError,
            );
        }

        // Fallback: get email from Firestore
        const db = admin.firestore();
        const userDoc = await db.collection("users").doc(userId).get();

        if (userDoc.exists) {
            return userDoc.data()?.email || null;
        }

        return null;
    } catch (error) {
        console.error("Error getting user email:", error);
        return null;
    }
}
