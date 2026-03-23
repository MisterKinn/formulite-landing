import { NextRequest, NextResponse } from "next/server";
import getFirebaseAdmin from "@/lib/firebaseAdmin";
import {
    canPurchaseTokenPack,
    getTokenPackProducts,
} from "@/lib/tokenPacks";
import { resolveEffectiveUsagePlan } from "@/lib/aiUsage";

export async function GET(request: NextRequest) {
    try {
        const userId = request.nextUrl.searchParams.get("userId");
        if (!userId) {
            return NextResponse.json(
                { eligible: false, error: "userId가 필요합니다." },
                { status: 400 },
            );
        }

        const admin = getFirebaseAdmin();
        const userDoc = await admin.firestore().collection("users").doc(userId).get();
        const userData = userDoc.exists
            ? (userDoc.data() as Record<string, unknown>)
            : null;

        const eligible = canPurchaseTokenPack(userData);
        const plan = userData ? resolveEffectiveUsagePlan(userData) : "free";

        return NextResponse.json({
            eligible,
            plan,
            packs: getTokenPackProducts(),
            message: eligible
                ? "토큰 단건 결제를 진행할 수 있습니다."
                : "활성 유료 구독 중인 선생님만 추가 토큰을 구매할 수 있습니다.",
        });
    } catch (error) {
        console.error("Token pack eligibility error:", error);
        return NextResponse.json(
            {
                eligible: false,
                error: "토큰 구매 가능 여부를 확인하지 못했습니다.",
            },
            { status: 500 },
        );
    }
}
