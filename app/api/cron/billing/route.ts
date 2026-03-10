import { NextRequest, NextResponse } from "next/server";
import { triggerMonthlyBilling } from "@/lib/monthlyBilling";

// Manual trigger for monthly billing
// In production, this should be protected with authentication
export async function POST(request: NextRequest) {
    try {
        // TODO: Add authentication check here
        const result = await triggerMonthlyBilling();

        return NextResponse.json(result);
    } catch (error) {
        console.error("Cron error:", error);
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        );
    }
}
