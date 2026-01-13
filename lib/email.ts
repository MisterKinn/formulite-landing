// Email notification system
import { getAuth } from "firebase/auth";
import { app } from "@/firebaseConfig";

interface PaymentReceiptData {
    orderId: string;
    amount: number;
    method: string;
    approvedAt: string;
}

interface PaymentFailureData {
    orderId?: string;
    failReason: string;
    isRecurring?: boolean;
}

// Send payment receipt email
export async function sendPaymentReceipt(
    userId: string,
    data: PaymentReceiptData
) {
    try {
        // TODO: Get user email from Firebase
        const userEmail = await getUserEmail(userId);

        if (!userEmail) {
            console.error("No email found for user:", userId);
            return;
        }

        const emailContent = `
안녕하세요,

Nova AI 결제가 완료되었습니다.

주문번호: ${data.orderId}
결제금액: ${data.amount.toLocaleString()}원
결제수단: ${data.method}
결제일시: ${new Date(data.approvedAt).toLocaleString("ko-KR")}

감사합니다.
Nova AI 팀
        `.trim();

        await sendEmail({
            to: userEmail,
            subject: "[Nova AI] 결제 완료 안내",
            text: emailContent,
        });

        console.log("✅ Receipt email sent to:", userEmail);
    } catch (error) {
        console.error("Error sending receipt:", error);
    }
}

// Send payment failure notification
export async function sendPaymentFailureNotification(
    userId: string,
    data: PaymentFailureData
) {
    try {
        const userEmail = await getUserEmail(userId);

        if (!userEmail) {
            console.error("No email found for user:", userId);
            return;
        }

        const emailContent = `
안녕하세요,

${data.isRecurring ? "정기 결제" : "결제"}가 실패했습니다.

${data.orderId ? `주문번호: ${data.orderId}` : ""}
실패 사유: ${data.failReason}

${
    data.isRecurring
        ? "구독이 일시 중지되었습니다. 결제 정보를 업데이트해주세요."
        : "다시 시도하시거나 다른 결제 수단을 이용해주세요."
}

문의사항이 있으시면 고객센터로 연락주세요.

Nova AI 팀
        `.trim();

        await sendEmail({
            to: userEmail,
            subject: `[Nova AI] ${
                data.isRecurring ? "정기 " : ""
            }결제 실패 안내`,
            text: emailContent,
        });

        console.log("✅ Failure notification sent to:", userEmail);
    } catch (error) {
        console.error("Error sending failure notification:", error);
    }
}

// Send subscription renewal reminder (3 days before)
export async function sendRenewalReminder(
    userId: string,
    amount: number,
    nextBillingDate: string
) {
    try {
        const userEmail = await getUserEmail(userId);

        if (!userEmail) {
            return;
        }

        const emailContent = `
안녕하세요,

Nova AI 구독 갱신 안내입니다.

다음 결제 예정일: ${new Date(nextBillingDate).toLocaleDateString("ko-KR")}
결제 예정 금액: ${amount.toLocaleString()}원

등록된 카드로 자동 결제됩니다.

Nova AI 팀
        `.trim();

        await sendEmail({
            to: userEmail,
            subject: "[Nova AI] 구독 갱신 안내",
            text: emailContent,
        });

        console.log("✅ Renewal reminder sent to:", userEmail);
    } catch (error) {
        console.error("Error sending renewal reminder:", error);
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
    html?: string
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
                raw.slice(0, 1000)
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
    resetLink: string
) {
    try {
        const subject = "[Nova AI] 비밀번호 재설정 안내";
        const text = `안녕하세요,

Nova AI 사용자분께서 비밀번호 재설정을 요청하셨습니다.\n아래 링크를 클릭하여 새 비밀번호를 설정하세요.\n링크는 보안을 위해 1시간의 유효기간이 있습니다.
${resetLink}

위 링크를 요청하지 않으셨다면 이 메일을 무시하셔도 됩니다.

감사합니다.
Nova AI 팀`.trim();

        const baseUrl = (
            process.env.NEXT_PUBLIC_BASE_URL ||
            process.env.NEXT_PUBLIC_APP_URL ||
            process.env.BASE_URL ||
            "http://localhost:3000"
        ).replace(/\/$/, "");

        let logoUrl = process.env.EMAIL_LOGO_URL || `${baseUrl}/nova-logo.svg`;

        const html = `<!doctype html>
                        <html lang="ko">
                            <body style="margin:0; padding:0; background:#f9fafb; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;">
                                <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#f9fafb;">
                                <tr>
                                    <td align="center" style="padding:40px 16px;">
                                    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px; background:#ffffff; border-radius:8px; box-shadow:0 2px 8px rgba(0,0,0,0.08);">
                                        
                                        <!-- Logo -->
                                        <tr>
                                        <td style="padding:32px 32px 24px;">
                                            <img
                                            src="${logoUrl}"
                                            alt="Nova AI"
                                            height="48"
                                            style="display:block; width:auto; height:48px;"
                                            />
                                        </td>
                                        </tr>

                                        <!-- Title -->
                                        <tr>
                                        <td style="padding:0 32px 16px;">
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

        const baseUrl = (
            process.env.NEXT_PUBLIC_BASE_URL ||
            process.env.NEXT_PUBLIC_APP_URL ||
            process.env.BASE_URL ||
            "http://localhost:3000"
        ).replace(/\/$/, "");

        let logoUrl = process.env.EMAIL_LOGO_URL || `${baseUrl}/nova-logo.png`;

        // If the logo will be a localhost URL (dev), and there is no explicit EMAIL_LOGO_URL,
        // embed a small inline SVG as data URI so recipients see a logo instead of a broken image.
        const isLocalHostLogo =
            /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//i.test(logoUrl);
        if (isLocalHostLogo && !process.env.EMAIL_LOGO_URL) {
            try {
                const svg = `<?xml version="1.0" encoding="UTF-8"?><svg xmlns='http://www.w3.org/2000/svg' width='48' height='48' viewBox='0 0 48 48' role='img' aria-label='Nova AI'><rect rx='8' width='48' height='48' fill='#7c3aed'/><text x='50%' y='52%' font-size='22' fill='#ffffff' font-family='-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif' text-anchor='middle' dominant-baseline='middle'>N</text></svg>`;
                const b64 = Buffer.from(svg).toString("base64");
                logoUrl = `data:image/svg+xml;base64,${b64}`;
                console.info(
                    "[email] using inline SVG logo for emails (dev mode)"
                );
            } catch (e) {
                console.warn(
                    "[email] failed to create inline SVG logo fallback",
                    e
                );
            }
        }

        // Optionally embed remote logo as data URI to avoid external image blocking in email clients.
        // But if the user explicitly sets EMAIL_LOGO_URL, prefer using that URL directly
        // (do not embed) so recipients fetch the image from the CDN.
        const embedAllowed =
            process.env.EMAIL_EMBED_LOGO !== "false" &&
            !process.env.EMAIL_LOGO_URL;
        if (embedAllowed && logoUrl && !logoUrl.startsWith("data:")) {
            try {
                const resp = await fetch(logoUrl);
                if (resp.ok) {
                    const contentType =
                        resp.headers.get("content-type") || "image/png";
                    const contentLength = Number(
                        resp.headers.get("content-length") || "0"
                    );
                    const MAX_EMBED_BYTES = 100 * 1024; // 100KB

                    if (!contentLength || contentLength <= MAX_EMBED_BYTES) {
                        const arrayBuffer = await resp.arrayBuffer();
                        const buf = Buffer.from(arrayBuffer);
                        if (buf.length <= MAX_EMBED_BYTES) {
                            logoUrl = `data:${contentType};base64,${buf.toString(
                                "base64"
                            )}`;
                            console.info(
                                "[email] embedded remote logo as data URI"
                            );
                        } else {
                            console.info(
                                "[email] remote logo too large to embed, skipping"
                            );
                        }
                    } else {
                        console.info(
                            "[email] remote logo content-length exceeds embed threshold, skipping"
                        );
                    }
                } else {
                    console.warn(
                        "[email] failed to fetch logo for embedding",
                        resp.status
                    );
                }
            } catch (e) {
                console.warn(
                    "[email] error when trying to fetch and embed logo",
                    e
                );
            }
        }

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

// Get user email from Firebase
async function getUserEmail(userId: string): Promise<string | null> {
    try {
        const auth = getAuth(app);
        const user = auth.currentUser;

        if (user && user.uid === userId) {
            return user.email;
        }

        // If not current user, we need to fetch from Firestore
        // For server-side, we should store email in Firestore during signup
        const { doc, getDoc, getFirestore } = await import(
            "firebase/firestore"
        );
        const db = getFirestore(app);
        const userDoc = await getDoc(doc(db, "users", userId));

        if (userDoc.exists()) {
            return userDoc.data()?.email || null;
        }

        return null;
    } catch (error) {
        console.error("Error getting user email:", error);
        return null;
    }
}
