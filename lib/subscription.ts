import {
    getFirestore,
    doc,
    setDoc,
    getDoc,
    updateDoc,
} from "firebase/firestore";
import { app } from "../firebaseConfig";

const db = getFirestore(app);

export interface SubscriptionData {
    plan: "free" | "basic" | "plus" | "pro";
    billingKey?: string;
    customerKey?: string;
    /** true for recurring subscriptions */
    isRecurring?: boolean;
    /** 'monthly' or 'yearly' when recurring */
    billingCycle?: "monthly" | "yearly";
    /** productId refers to the product catalog item we store */
    productId?: string;
    /** subscriptionId is our server-side id for the subscription contract */
    subscriptionId?: string;
    startDate: string;
    nextBillingDate?: string;
    status: "active" | "cancelled" | "expired";
    amount?: number;
}

// Store billing key and subscription info
function sanitizeForFirestore<T extends Record<string, any>>(obj: T): T {
    if (!obj || typeof obj !== "object") return obj;
    const out: any = Array.isArray(obj) ? [] : {};
    for (const key of Object.keys(obj)) {
        const val = (obj as any)[key];
        if (val === undefined) continue;
        if (val && typeof val === "object" && !Array.isArray(val)) {
            out[key] = sanitizeForFirestore(val);
        } else {
            out[key] = val;
        }
    }
    return out as T;
}

export async function saveSubscription(userId: string, data: SubscriptionData) {
    try {
        const userRef = doc(db, "users", userId);
        const sanitized = sanitizeForFirestore(data as any);

        // Get current user data to preserve aiCallUsage if it exists
        const userDoc = await getDoc(userRef);
        const currentData = userDoc.exists() ? userDoc.data() : {};

        await setDoc(
            userRef,
            {
                subscription: sanitized,
                plan: data.plan, // Store plan at root level for easy access
                aiCallUsage: currentData.aiCallUsage ?? 0, // Preserve existing usage or initialize to 0
                updatedAt: new Date().toISOString(),
            },
            { merge: true }
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
    productData: { plan: SubscriptionData["plan"]; price: number }
) {
    try {
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
    data: SubscriptionData & { productId: string; subscriptionId: string }
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
        const userRef = doc(db, "users", userId);
        const userDoc = await getDoc(userRef);

        if (userDoc.exists()) {
            return userDoc.data().subscription as SubscriptionData;
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
    plan: "free" | "plus" | "pro"
) {
    try {
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

// Calculate next billing date (30 days for monthly, 365 days for yearly)
export function getNextBillingDate(
    billingCycle: "monthly" | "yearly" = "monthly"
): string {
    const date = new Date();
    if (billingCycle === "monthly") {
        date.setDate(date.getDate() + 30);
    } else {
        date.setDate(date.getDate() + 365);
    }
    return date.toISOString();
}
