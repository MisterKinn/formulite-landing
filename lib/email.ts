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
}: {
    to: string;
    subject: string;
    text: string;
}) {
    // Option 1: Use email API service (Resend, SendGrid, etc.)
    if (process.env.RESEND_API_KEY) {
        return await sendViaResend(to, subject, text);
    }

    // Option 2: Use mailto (for development/testing)
    console.log("📧 Email (development mode):");
    console.log("To:", to);
    console.log("Subject:", subject);
    console.log("Body:", text);
}

// Send via Resend (recommended)
async function sendViaResend(to: string, subject: string, text: string) {
    try {
        const response = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                from: "Nova AI <noreply@formulite.ai>",
                to: [to],
                subject,
                text,
            }),
        });

        if (!response.ok) {
            throw new Error("Failed to send email");
        }

        return await response.json();
    } catch (error) {
        console.error("Resend error:", error);
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
