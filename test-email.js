const { sendPaymentReceipt } = require("./lib/email.ts");

async function testEmail() {
    await sendPaymentReceipt("test_user_id", {
        orderId: "order_123",
        amount: 9900,
        method: "카드",
        approvedAt: new Date().toISOString(),
        email: "kinn@kinn.kr",
    });
    console.log("✅ Email test complete");
}

testEmail();
