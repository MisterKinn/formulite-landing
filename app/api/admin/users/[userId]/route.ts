export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { verifyAdmin, admin } from "@/lib/adminAuth";

const db = admin.firestore();

/**
 * DELETE /api/admin/users/[userId]
 * Deletes a user from Firebase Auth and Firestore (including payments subcollection)
 */
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ userId: string }> },
) {
    const adminUser = await verifyAdmin(request.headers.get("Authorization"));

    if (!adminUser) {
        return NextResponse.json(
            { error: "Unauthorized - Admin access required" },
            { status: 403 },
        );
    }

    const { userId } = await params;

    if (!userId) {
        return NextResponse.json(
            { error: "User ID is required" },
            { status: 400 },
        );
    }

    // Prevent admin from deleting themselves
    if (userId === adminUser.uid) {
        return NextResponse.json(
            { error: "Cannot delete your own account" },
            { status: 400 },
        );
    }

    try {
        // 1. Delete payments subcollection first
        const paymentsRef = db
            .collection("users")
            .doc(userId)
            .collection("payments");
        const paymentsSnapshot = await paymentsRef.get();

        const batch = db.batch();
        paymentsSnapshot.docs.forEach((doc) => {
            batch.delete(doc.ref);
        });

        // 2. Delete user document from Firestore
        batch.delete(db.collection("users").doc(userId));

        await batch.commit();

        // 3. Delete user from Firebase Auth
        try {
            await admin.auth().deleteUser(userId);
        } catch (authError: any) {
            // User might not exist in Auth (e.g., if they signed up differently)
            if (authError.code !== "auth/user-not-found") {
                console.error("Failed to delete user from Auth:", authError);
            }
        }

        return NextResponse.json({
            success: true,
            message: "User deleted successfully",
            deletedPayments: paymentsSnapshot.size,
        });
    } catch (error) {
        console.error("Delete user error:", error);
        return NextResponse.json(
            { error: "Failed to delete user" },
            { status: 500 },
        );
    }
}
