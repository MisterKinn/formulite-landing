import {
    getFirestore,
    doc,
    setDoc,
    getDoc,
    updateDoc,
} from "firebase/firestore";
import { getFirebaseApp } from "../firebaseConfig";
import { buildUserRootPatch, sanitizeForFirestore } from "@/lib/userData";

function getDb() {
    return getFirestore(getFirebaseApp());
}

export interface SubscriptionData {
    plan: "free" | "go" | "plus" | "pro" | "test";
    billingKey?: string;
    customerKey?: string;
    /** true for recurring subscriptions */
    isRecurring?: boolean;
    /** 'monthly', 'yearly', or 'test' (1 minute) when recurring */
    billingCycle?: "monthly" | "yearly" | "test";
    /** productId refers to the product catalog item we store */
    productId?: string;
    /** subscriptionId is our server-side id for the subscription contract */
    subscriptionId?: string;
    startDate: string;
    nextBillingDate?: string;
    status: "active" | "cancelled" | "expired";
    amount?: number;
}

export async function saveSubscription(
    userId: string,
    data: SubscriptionData,
    options?: { resetUsageAt?: string },
) {
    try {
        const db = getDb();
        const userRef = doc(db, "users", userId);
        const sanitized = sanitizeForFirestore(data as any);

        // Get current user data to preserve aiCallUsage if it exists
        const userDoc = await getDoc(userRef);
        const currentData = userDoc.exists() ? userDoc.data() : {};

        await setDoc(
            userRef,
            buildUserRootPatch({
                existingUser: currentData,
                subscription: sanitized,
                plan: data.plan,
                aiCallUsage: options?.resetUsageAt ? 0 : undefined,
                usageResetAt: options?.resetUsageAt,
            }),
            { merge: true },
        );
        return { success: true };
    } catch (error) {
        console.error("Error saving subscription:", error);
        return { success: false, error };
    }
}

// Create product if missing (product catalog stored under 'products')
export async function createProductIfNotExists(
    productId: string,
    productData: { plan: SubscriptionData["plan"]; price: number },
) {
    try {
        const db = getDb();
        const productRef = doc(db, "products", productId);
        const prod = await getDoc(productRef);
        if (!prod.exists()) {
            await setDoc(productRef, {
                id: productId,
                plan: productData.plan,
                price: productData.price,
                createdAt: new Date().toISOString(),
            });
        }
        return { success: true };
    } catch (err) {
        console.error("Failed to create product:", err);
        return { success: false, error: err };
    }
}

// Create a subscription record (server-side subscription contract id) and save under user's subscription
export async function createSubscriptionEntry(
    userId: string,
    data: SubscriptionData & { productId: string; subscriptionId: string },
) {
    try {
        // ensure product exists (best-effort)
        await createProductIfNotExists(data.productId, {
            plan: data.plan,
            price: data.amount ?? 0,
        });

        // save subscription under user
        return await saveSubscription(userId, data);
    } catch (err) {
        console.error("Failed to create subscription entry:", err);
        return { success: false, error: err };
    }
}

// Get user's subscription
export async function getSubscription(userId: string) {
    try {
        const db = getDb();
        const userRef = doc(db, "users", userId);
        const userDoc = await getDoc(userRef);

        if (userDoc.exists()) {
            const data = userDoc.data();
            const rootSubscription = data.subscription as SubscriptionData | undefined;
            if (rootSubscription) return rootSubscription;

            const legacySubscriptionDoc = await getDoc(
                doc(db, "users", userId, "subscription", "current"),
            );
            if (legacySubscriptionDoc.exists()) {
                return legacySubscriptionDoc.data() as SubscriptionData;
            }
        }
        return null;
    } catch (error) {
        console.error("Error getting subscription:", error);
        return null;
    }
}

// Update user plan
export async function updateUserPlan(
    userId: string,
    plan: "free" | "go" | "plus" | "pro",
) {
    try {
        const db = getDb();
        const userRef = doc(db, "users", userId);
        await updateDoc(userRef, {
            "subscription.plan": plan,
            updatedAt: new Date().toISOString(),
        });
        return { success: true };
    } catch (error) {
        console.error("Error updating plan:", error);
        return { success: false, error };
    }
}

// Calculate next billing date (30 days for monthly, 365 days for yearly, 1 minute for test)
export function getNextBillingDate(
    billingCycle: "monthly" | "yearly" | "test" = "monthly",
): string {
    const date = new Date();
    if (billingCycle === "test") {
        // Test billing: 1 minute interval
        date.setTime(date.getTime() + 60 * 1000);
    } else if (billingCycle === "monthly") {
        // Monthly billing should advance exactly one calendar month.
        date.setMonth(date.getMonth() + 1);
    } else {
        // Yearly billing should advance exactly one calendar year.
        date.setFullYear(date.getFullYear() + 1);
    }
    return date.toISOString();
}
