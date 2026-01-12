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
    plan: "free" | "plus" | "pro";
    billingKey?: string;
    customerKey?: string;
    /** true for recurring subscriptions */
    isRecurring?: boolean;
    /** 'monthly' or 'yearly' when recurring */
    billingCycle?: "monthly" | "yearly";
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
        await setDoc(
            userRef,
            {
                subscription: sanitized,
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
export function getNextBillingDate(billingCycle: "monthly" | "yearly" = "monthly"): string {
    const date = new Date();
    if (billingCycle === "monthly") {
        date.setDate(date.getDate() + 30);
    } else {
        date.setDate(date.getDate() + 365);
    }
    return date.toISOString();
}
