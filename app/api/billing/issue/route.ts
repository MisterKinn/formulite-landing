import { NextRequest, NextResponse } from "next/server";
import { getFirestore, doc, setDoc, getDoc } from "firebase/firestore";
import { app } from "@/firebaseConfig";

const db = getFirestore(app);

/**
 * 빌링키 발급 API
 * authKey와 customerKey를 받아서 토스페이먼츠에 빌링키 발급 요청
 */
export async function POST(request: NextRequest) {
    try {
        const { authKey, customerKey, amount, orderName, billingCycle } =
            await request.json();

        if (!authKey || !customerKey) {
            return NextResponse.json(
                { success: false, error: "authKey와 customerKey가 필요합니다" },
                { status: 400 }
            );
        }

        console.log("═══════════════════════════════════════");
        console.log("🔑 [서버] 빌링키 발급 프로세스");
        console.log("═══════════════════════════════════════");
        console.log("📥 요청:");
        console.log("   - authKey:", authKey.substring(0, 20) + "...");
        console.log("   - customerKey:", customerKey);

        const secretKey = process.env.TOSS_SECRET_KEY!;
        const encodedKey = Buffer.from(secretKey + ":").toString("base64");

        // 토스페이먼츠 빌링키 발급 API 호출
        const response = await fetch(
            `https://api.tosspayments.com/v1/billing/authorizations/${authKey}`,
            {
                method: "POST",
                headers: {
                    Authorization: `Basic ${encodedKey}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ customerKey }),
            }
        );

        const result = await response.json();

        if (!response.ok) {
            console.error("❌ 토스페이먼츠 빌링키 발급 실패:", result);
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

        console.log("✅ [서버] 빌링키 발급 성공!");
        console.log("   - billingKey:", billingKey.substring(0, 30) + "...");
        console.log("───────────────────────────────────────");

        if (!billingKey) {
            return NextResponse.json(
                { success: false, error: "빌링키를 받지 못했습니다" },
                { status: 500 }
            );
        }

        console.log("🔑 빌링키 발급 성공!");
        console.log("   - 빌링키:", billingKey);
        console.log("   - customerKey:", customerKey);

        // customerKey에서 userId 추출 (customer_ 형식과 user_ 형식 모두 지원)
        const userId = extractUserIdFromCustomerKey(customerKey);

        console.log("💾 Firestore 저장 중...");
        console.log("   - userId:", userId);

        if (!userId) {
            return NextResponse.json(
                {
                    success: false,
                    error: "유효하지 않은 customerKey 형식입니다",
                },
                { status: 400 }
            );
        }

        console.log("   - userId:", userId);

        // 구독 정보가 있으면 활성 구독으로 설정
        // Determine plan based on amount
        let plan: "free" | "basic" | "plus" | "pro" = "free";
        if (amount) {
            if (amount >= 29900) {
                plan = "pro";
            } else if (amount >= 19900) {
                plan = "plus";
            } else if (amount >= 9900) {
                plan = "basic";
            }
        }

        const subscriptionData = {
            billingKey,
            customerKey,
            plan,
            status: amount ? "active" : "billing_registered", // 구독 정보가 있으면 바로 활성화
            registeredAt: new Date().toISOString(),
            isRecurring: !!amount, // 금액이 있으면 구독 활성화
            amount: amount || 0,
            orderName: orderName || "Nova AI 구독",
            billingCycle: billingCycle || "monthly",
            nextBillingDate: amount
                ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() // 30일 후
                : null,
        };

        await saveBillingKeyToFirestore(userId, subscriptionData);

        console.log("✅ [서버] Firestore 저장 완료!");
        console.log("   - plan:", subscriptionData.plan);
        console.log("   - status:", subscriptionData.status);
        console.log("   - amount:", subscriptionData.amount);
        console.log("   - nextBillingDate:", subscriptionData.nextBillingDate);
        console.log("═══════════════════════════════════════");

        return NextResponse.json({
            success: true,
            billingKey: billingKey, // 첫 결제를 위해 전체 반환
            subscription: subscriptionData,
            message: amount
                ? "구독이 성공적으로 시작되었습니다"
                : "카드가 성공적으로 등록되었습니다",
        });
    } catch (error) {
        console.error("빌링키 발급 API 오류:", error);

        return NextResponse.json(
            {
                success: false,
                error: "내부 서버 오류가 발생했습니다",
                details:
                    error instanceof Error ? error.message : "Unknown error",
            },
            { status: 500 }
        );
    }
}

/**
 * customerKey에서 userId 추출
 * 형식: "customer_{userId}_{timestamp}" 또는 "user_{userId}"
 */
function extractUserIdFromCustomerKey(customerKey: string): string | null {
    try {
        const parts = customerKey.split("_");

        // "customer_{userId}_{timestamp}" 형식
        if (parts.length >= 3 && parts[0] === "customer") {
            return parts[1]; // userId 부분
        }

        // "user_{userId}" 형식
        if (parts.length >= 2 && parts[0] === "user") {
            return parts[1]; // userId 부분
        }

        return null;
    } catch (error) {
        console.error("customerKey 파싱 오류:", error);
        return null;
    }
}

/**
 * Firestore에 빌링키 정보 저장
 */
async function saveBillingKeyToFirestore(
    userId: string,
    subscriptionData: any
) {
    try {
        const userRef = doc(db, "users", userId);

        // 기존 사용자 데이터 조회
        const userDoc = await getDoc(userRef);
        const existingData = userDoc.exists() ? userDoc.data() : {};

        // subscription 정보 업데이트
        await setDoc(
            userRef,
            {
                ...existingData,
                subscription: {
                    ...existingData.subscription,
                    ...subscriptionData,
                },
                updatedAt: new Date().toISOString(),
            },
            { merge: true }
        );

        console.log("Firestore 저장 성공:", userId);
    } catch (error) {
        console.error("Firestore 저장 실패:", error);
        throw new Error("데이터베이스 저장에 실패했습니다");
    }
}
