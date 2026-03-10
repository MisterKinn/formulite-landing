import { getFirestore, doc, getDoc, setDoc } from "firebase/firestore";
import { getFirebaseApp } from "@/firebaseConfig";

/**
 * Initialize or ensure user has plan and aiCallUsage fields
 */
export async function ensureUserDefaults(userId: string) {
    try {
        const db = getFirestore(getFirebaseApp());
        const userRef = doc(db, "users", userId);
        const userDoc = await getDoc(userRef);

        if (!userDoc.exists()) {
            // New user - create with defaults
            await setDoc(userRef, {
                plan: "free",
                aiCallUsage: 0,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            });
            console.log(`✅ Initialized new user ${userId} with free plan`);
        } else {
            // Existing user - ensure fields exist
            const data = userDoc.data();
            const updates: any = {};

            if (!data.plan) {
                updates.plan = "free";
            }
            if (data.aiCallUsage === undefined) {
                updates.aiCallUsage = 0;
            }

            if (Object.keys(updates).length > 0) {
                updates.updatedAt = new Date().toISOString();
                await setDoc(userRef, updates, { merge: true });
                console.log(
                    `✅ Updated user ${userId} with missing fields:`,
                    updates
                );
            }
        }

        return { success: true };
    } catch (error) {
        console.error("Error ensuring user defaults:", error);
        return { success: false, error };
    }
}
