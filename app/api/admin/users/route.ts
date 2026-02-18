export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { verifyAdmin, admin } from "@/lib/adminAuth";
import { getTierLimit, PlanTier } from "@/lib/tierLimits";
import { normalizeCreatedAt } from "@/lib/userData";

const db = admin.firestore();

async function listAllAuthUsers() {
    let pageToken: string | undefined = undefined;
    const users: Array<{
        uid: string;
        email: string;
        displayName: string;
        photoURL: string;
        createdAt: string;
    }> = [];

    do {
        const result = await admin.auth().listUsers(1000, pageToken);
        result.users.forEach((user) => {
            users.push({
                uid: user.uid,
                email: user.email || "",
                displayName: user.displayName || "",
                photoURL: user.photoURL || "",
                createdAt: normalizeCreatedAt(user.metadata.creationTime),
            });
        });
        pageToken = result.pageToken;
    } while (pageToken);

    return users;
}

interface AdminUserListItem {
    uid: string;
    email: string;
    displayName: string;
    photoURL: string;
    createdAt: string;
    cumulativeAmount: number;
    subscription: {
        plan: string;
        status: string;
        amount: number;
        billingCycle: string;
        startDate: string;
        nextBillingDate: string;
        failureCount: number;
        lastFailureReason?: string;
    };
    usage: {
        today: number;
        limit: number;
        remaining: number;
    };
}

/**
 * GET /api/admin/users
 * Returns list of all users with subscription info
 * Query params: limit, offset, search (email), plan, status
 */
export async function GET(request: NextRequest) {
    const adminUser = await verifyAdmin(request.headers.get("Authorization"));

    if (!adminUser) {
        return NextResponse.json(
            { error: "Unauthorized - Admin access required" },
            { status: 403 },
        );
    }

    try {
        const resolvedProjectId =
            admin.app().options.projectId ||
            process.env.FIREBASE_PROJECT_ID ||
            process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
            "";
        const { searchParams } = new URL(request.url);
        const limit = parseInt(searchParams.get("limit") || "50");
        const offset = parseInt(searchParams.get("offset") || "0");
        const search = searchParams.get("search")?.toLowerCase();
        const planFilter = searchParams.get("plan");
        const statusFilter = searchParams.get("status");

        const usersRef = db.collection("users");
        const [usersSnapshot, authUsers] = await Promise.all([
            usersRef.get(),
            listAllAuthUsers(),
        ]);

        const mergedUsers = new Map<string, AdminUserListItem>();
        const authUsersByUid = new Map(authUsers.map((authUser) => [authUser.uid, authUser]));

        usersSnapshot.forEach((doc) => {
            const data = doc.data();
            const authUser = authUsersByUid.get(doc.id);
            const subscription = data.subscription || {};
            const plan = (subscription.plan || data.plan || "free") as PlanTier;
            const status = String(subscription.status || "none");
            const todayUsage = data.aiCallUsage || 0;
            const usageLimit = getTierLimit(plan);
            const remainingUsage = Math.max(0, usageLimit - todayUsage);

            mergedUsers.set(doc.id, {
                uid: doc.id,
                // Firebase Auth 이메일을 최우선으로 사용해 admin 화면과 실제 인증 정보 일치 보장
                email: authUser?.email || data.email || "",
                displayName: data.displayName || authUser?.displayName || "",
                photoURL:
                    data.avatar || data.photoURL || authUser?.photoURL || "",
                createdAt: normalizeCreatedAt(
                    data.createdAt || authUser?.createdAt,
                ),
                cumulativeAmount: 0,
                subscription: {
                    plan: plan,
                    status: status,
                    amount: subscription.amount || 0,
                    billingCycle: subscription.billingCycle || "monthly",
                    startDate: subscription.startDate,
                    nextBillingDate: subscription.nextBillingDate,
                    failureCount: subscription.failureCount || 0,
                    lastFailureReason: subscription.lastFailureReason,
                },
                usage: {
                    today: todayUsage,
                    limit: usageLimit,
                    remaining: remainingUsage,
                },
            });
        });

        // Firestore 문서가 없는 Auth 사용자도 관리자 목록에 노출
        authUsers.forEach((authUser) => {
            const existing = mergedUsers.get(authUser.uid);
            if (existing) {
                // Firestore 문서가 있어도 이메일/프로필이 비어있으면 Auth 값으로 보정
                if (!existing.email) existing.email = authUser.email || "";
                if (!existing.displayName) {
                    existing.displayName = authUser.displayName || "";
                }
                if (!existing.photoURL) existing.photoURL = authUser.photoURL || "";
                if (!existing.createdAt) {
                    existing.createdAt = authUser.createdAt || "";
                }
                return;
            }

            const usageLimit = getTierLimit("free");
            mergedUsers.set(authUser.uid, {
                uid: authUser.uid,
                email: authUser.email,
                displayName: authUser.displayName,
                photoURL: authUser.photoURL,
                createdAt: authUser.createdAt,
                cumulativeAmount: 0,
                subscription: {
                    plan: "free",
                    status: "none",
                    amount: 0,
                    billingCycle: "monthly",
                    startDate: "",
                    nextBillingDate: "",
                    failureCount: 0,
                },
                usage: {
                    today: 0,
                    limit: usageLimit,
                    remaining: usageLimit,
                },
            });
        });

        // 누적 결제 금액 계산 (DONE 상태 합계)
        await Promise.all(
            Array.from(mergedUsers.keys()).map(async (uid) => {
                try {
                    const paymentsSnapshot = await db
                        .collection("users")
                        .doc(uid)
                        .collection("payments")
                        .get();

                    let cumulativeAmount = 0;
                    paymentsSnapshot.forEach((paymentDoc) => {
                        const payment = paymentDoc.data() as {
                            status?: string;
                            amount?: number;
                        };
                        if (payment.status === "DONE") {
                            cumulativeAmount += Number(payment.amount || 0);
                        }
                    });

                    const user = mergedUsers.get(uid);
                    if (user) {
                        user.cumulativeAmount = cumulativeAmount;
                    }
                } catch {
                    // 누적 금액 계산 실패 시 0원 유지
                }
            }),
        );

        let users = Array.from(mergedUsers.values()).filter((user) => {
            const email = user.email.toLowerCase();
            const displayName = user.displayName.toLowerCase();
            const plan = user.subscription.plan;
            const status = user.subscription.status;

            if (
                search &&
                !email.includes(search) &&
                !displayName.includes(search)
            ) {
                return false;
            }
            if (planFilter && plan !== planFilter) return false;
            if (statusFilter && status !== statusFilter) return false;
            return true;
        });

        // Sort by createdAt descending
        users.sort((a, b) => {
            const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
            const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
            return dateB - dateA;
        });

        const total = users.length;

        // Apply pagination
        users = users.slice(offset, offset + limit);

        return NextResponse.json({
            users,
            total,
            limit,
            offset,
            diagnostics: {
                projectId: resolvedProjectId,
                authUsersCount: authUsers.length,
                firestoreUsersCount: usersSnapshot.size,
            },
        });
    } catch (error) {
        console.error("Admin users error:", error);
        const errorMessage =
            error instanceof Error ? error.message : String(error);
        return NextResponse.json({
            users: [],
            total: 0,
            limit: 50,
            offset: 0,
            warning:
                "firebase_admin_not_configured: check FIREBASE_ADMIN_CREDENTIALS and project settings",
            error: errorMessage,
        });
    }
}
