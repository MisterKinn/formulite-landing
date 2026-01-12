import { NextRequest, NextResponse } from "next/server";

/**
 * 결제 성공 후 빌링키 자동 발급
 * POST /api/billing/from-payment
 *
 * 결제위젯으로 첫 결제 완료 후, 해당 결제 정보로 빌링키를 자동 발급받습니다.
 */
export async function POST(request: NextRequest) {
    try {
        const { paymentKey, customerKey, amount, orderName, billingCycle } =
            await request.json();

        if (!paymentKey || !customerKey) {
            return NextResponse.json(
                { success: false, error: "필수 파라미터 누락" },
                { status: 400 }
            );
        }

        console.log("═══════════════════════════════════════");
        console.log("🔑 [서버] 결제로부터 빌링키 발급");
        console.log("═══════════════════════════════════════");
        console.log("📥 요청 정보:");
        console.log("   - paymentKey:", paymentKey.substring(0, 20) + "...");
        console.log("   - customerKey:", customerKey);
        console.log("   - amount:", amount);
        console.log("");

        // 토스페이먼츠 빌링키 발급 API 호출
        const response = await fetch(
            `https://api.tosspayments.com/v1/payments/${paymentKey}/billing-key`,
            {
                method: "POST",
                headers: {
                    Authorization: `Basic ${Buffer.from(
                        process.env.TOSS_SECRET_KEY + ":"
                    ).toString("base64")}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    customerKey,
                }),
            }
        );

        const result = await response.json();

        if (!response.ok) {
            console.error("❌ 빌링키 발급 실패:", result);
            return NextResponse.json(
                {
                    success: false,
                    error:
                        result.message ||
                        `토스페이먼츠 API 오류 (${response.status})`,
                },
                { status: response.status }
            );
        }

        const { billingKey } = result;

        console.log("✅ 빌링키 발급 성공!");
        console.log("   - billingKey:", billingKey.substring(0, 30) + "...");
        console.log("═══════════════════════════════════════");

        // Firestore 저장 로직은 /api/billing/issue에서 재사용
        const userId = customerKey.replace(/^(customer_|user_)/, "");

        const subscriptionData = {
            billingKey,
            customerKey,
            plan: amount ? (amount >= 29900 ? "pro" : "plus") : "free",
            status: "active",
            registeredAt: new Date().toISOString(),
            isRecurring: true,
            amount: amount || 0,
            orderName: orderName || "Nova AI 구독",
            billingCycle: billingCycle || "monthly",
            nextBillingDate: new Date(
                Date.now() + 30 * 24 * 60 * 60 * 1000
            ).toISOString(),
        };

        // Firestore 저장
        const { getFirestore, doc, setDoc } = await import(
            "firebase/firestore"
        );
        const { app } = await import("../../../../firebaseConfig");
        const db = getFirestore(app);

        await setDoc(
            doc(db, "users", userId, "subscription", "current"),
            subscriptionData,
            { merge: true }
        );

        console.log("✅ Firestore 저장 완료!");
        console.log("   - userId:", userId);
        console.log("   - plan:", subscriptionData.plan);
        console.log("═══════════════════════════════════════");

        return NextResponse.json({
            success: true,
            billingKey,
            subscription: subscriptionData,
        });
    } catch (error: any) {
        console.error("빌링키 발급 오류:", error);
        return NextResponse.json(
            { success: false, error: error.message || "서버 오류" },
            { status: 500 }
        );
    }
}
