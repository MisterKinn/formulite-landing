import { NextRequest, NextResponse } from "next/server";
import getFirebaseAdmin from "@/lib/firebaseAdmin";

const ADMIN_EMAIL = "kinn@kinn.kr";

/**
 * DELETE /api/admin/payments/[paymentKey]
 * Delete a payment record from Firestore
 */
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ paymentKey: string }> }
) {
    try {
        const { paymentKey } = await params;

        // Verify admin authentication
        const authHeader = request.headers.get("authorization");
        if (!authHeader?.startsWith("Bearer ")) {
            return NextResponse.json(
                { error: "Unauthorized" },
                { status: 401 }
            );
        }

        const token = authHeader.split("Bearer ")[1];
        const admin = getFirebaseAdmin();

        let decodedToken;
        try {
            decodedToken = await admin.auth().verifyIdToken(token);
        } catch (error) {
            return NextResponse.json(
                { error: "Invalid token" },
                { status: 401 }
            );
        }

        // Check if user is admin
        const userRecord = await admin.auth().getUser(decodedToken.uid);
        if (userRecord.email?.toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
            return NextResponse.json(
                { error: "Forbidden" },
                { status: 403 }
            );
        }

        // Get userId from query params (required to locate the payment subcollection)
        const { searchParams } = new URL(request.url);
        const userId = searchParams.get("userId");

        if (!userId) {
            return NextResponse.json(
                { error: "userId is required" },
                { status: 400 }
            );
        }

        const db = admin.firestore();

        // Delete the payment document
        const paymentRef = db
            .collection("users")
            .doc(userId)
            .collection("payments")
            .doc(paymentKey);

        const paymentDoc = await paymentRef.get();
        if (!paymentDoc.exists) {
            return NextResponse.json(
                { error: "Payment not found" },
                { status: 404 }
            );
        }

        await paymentRef.delete();

        console.log(`✅ Admin deleted payment: ${paymentKey} for user ${userId}`);

        return NextResponse.json({
            success: true,
            message: "Payment deleted successfully",
        });
    } catch (error) {
        console.error("Delete payment error:", error);
        return NextResponse.json(
            {
                error:
                    error instanceof Error
                        ? error.message
                        : "Internal server error",
            },
            { status: 500 }
        );
    }
}
