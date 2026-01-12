import { NextRequest, NextResponse } from "next/server";
import {
    saveSubscription,
    getSubscription,
    getNextBillingDate,
} from "@/lib/subscription";
import {
    sendPaymentReceipt,
    sendPaymentFailureNotification,
} from "@/lib/email";
import { doc, getFirestore, setDoc } from "firebase/firestore";
import { app } from "@/firebaseConfig";

// Toss Payments Webhook Handler
export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { eventType, data } = body;

        console.log("📬 Webhook received:", eventType, data);

        // Verify webhook authenticity (optional but recommended)
        const signature = request.headers.get("toss-signature");
        if (!verifyWebhookSignature(signature, body)) {
            return NextResponse.json(
                { error: "Invalid signature" },
                { status: 401 }
            );
        }

        switch (eventType) {
            case "PAYMENT_COMPLETED":
                await handlePaymentCompleted(data);
                break;

            case "PAYMENT_FAILED":
                await handlePaymentFailed(data);
                break;

            case "PAYMENT_CANCELLED":
                await handlePaymentCancelled(data);
                break;

            case "BILLING_KEY_ISSUED":
                await handleBillingKeyIssued(data);
                break;

            case "BILLING_PAYMENT_COMPLETED":
                await handleBillingPaymentCompleted(data);
                break;

            case "BILLING_PAYMENT_FAILED":
                await handleBillingPaymentFailed(data);
                break;

            default:
                console.log("Unknown event type:", eventType);
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Webhook error:", error);
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        );
    }
}

// Verify webhook signature
function verifyWebhookSignature(signature: string | null, body: any): boolean {
    // TODO: Implement signature verification with Toss secret
    // For now, always return true in development
    if (process.env.NODE_ENV === "development") {
        return true;
    }

    // In production, verify the signature
    return !!signature;
}

// Handle successful one-time payment
async function handlePaymentCompleted(data: any) {
    console.log("✅ Payment completed:", data);

    // Extract user info from customerKey or metadata
    const userId = extractUserId(data.customerKey);

    if (userId) {
        // Send receipt email
        await sendPaymentReceipt(userId, {
            orderId: data.orderId,
            amount: data.totalAmount,
            method: data.method,
            approvedAt: data.approvedAt,
        });

        // Map amount to a plan (adjust prices as needed)
        const plan = amountToPlan(Number(data.totalAmount ?? data.amount ?? 0));
        const planPrice = Number(data.totalAmount ?? data.amount ?? 0);
        if (plan) {
            // Create a product id and subscription id for one-time purchase
            const productId = `product_${plan}`;
            const subscriptionId = `sub_${Date.now()}`;

            try {
                await createProductIfNotExists(productId, {
                    plan,
                    price: planPrice,
                });

                // Save subscription info to Firestore (one-time purchase -> isRecurring: false)
                await createSubscriptionEntry(userId, {
                    plan,
                    productId,
                    subscriptionId,
                    amount: planPrice,
                    startDate: new Date().toISOString(),
                    status: "active",
                    customerKey: data.customerKey,
                    isRecurring: false,
                });

                console.log(`Updated plan for user ${userId} -> ${plan}`);
            } catch (err) {
                console.error(
                    "Failed to save subscription after payment:",
                    err
                );
            }
        }
    }
}

function amountToPlan(amount: number): "plus" | "pro" | null {
    if (!isFinite(amount) || amount <= 0) return null;
    // Example mapping - adjust to match your product prices
    if (amount >= 19900) return "pro";
    if (amount >= 9900) return "plus";
    return null;
}

// Handle failed payment
async function handlePaymentFailed(data: any) {
    console.log("❌ Payment failed:", data);

    const userId = extractUserId(data.customerKey);

    if (userId) {
        await sendPaymentFailureNotification(userId, {
            orderId: data.orderId,
            failReason: data.failReason,
        });
    }
}

// Handle cancelled payment
async function handlePaymentCancelled(data: any) {
    console.log("🚫 Payment cancelled:", data);

    const userId = extractUserId(data.customerKey);

    if (userId) {
        // Update subscription status if needed
        const subscription = await getSubscription(userId);
        if (subscription) {
            const updated = {
                ...subscription,
                status: "cancelled",
                cancelledAt: new Date().toISOString(),
            } as any;
            await saveSubscription(userId, updated);

            // If a subscriptionId exists, also mark it cancelled in a subscriptions collection (best-effort)
            try {
                if (subscription.subscriptionId) {
                    const subRef = doc(
                        getFirestore(app),
                        "subscriptions",
                        subscription.subscriptionId
                    );
                    await setDoc(
                        subRef,
                        {
                            status: "cancelled",
                            cancelledAt: new Date().toISOString(),
                        },
                        { merge: true }
                    );
                }
            } catch (err) {
                // ignore
            }
        }
    }
}

// Handle billing key issued
async function handleBillingKeyIssued(data: any) {
    console.log("🔑 Billing key issued:", data);
    const userId = extractUserId(data.customerKey);
    if (userId) {
        try {
            // default to monthly unless we can infer otherwise
            const billingCycle: "monthly" | "yearly" =
                (data.billingCycle as any) || "monthly";

            // Map amount to plan if possible
            const plan =
                amountToPlan(Number(data.totalAmount ?? data.amount ?? 0)) ||
                "plus";

            // Generate productId and subscriptionId server-side
            const productId = `product_${plan}`;
            const subscriptionId = `sub_${Date.now()}`;

            await createProductIfNotExists(productId, {
                plan,
                price: Number(data.totalAmount ?? data.amount ?? 0),
            });

            await createSubscriptionEntry(userId, {
                plan: plan as any,
                billingKey: data.billingKey,
                customerKey: data.customerKey,
                isRecurring: true,
                billingCycle,
                productId,
                subscriptionId,
                startDate: new Date().toISOString(),
                nextBillingDate: getNextBillingDate(billingCycle),
                status: "active",
                amount: Number(data.totalAmount ?? data.amount ?? 0),
            });

            console.log(
                `Saved billing key and subscription for user ${userId} -> ${subscriptionId}`
            );
        } catch (err) {
            console.error("Failed to save billing key:", err);
        }
    }
}

// Handle successful recurring payment
async function handleBillingPaymentCompleted(data: any) {
    console.log("✅ Recurring payment completed:", data);

    const userId = extractUserId(data.customerKey);

    if (userId) {
        await sendPaymentReceipt(userId, {
            orderId: data.orderId,
            amount: data.totalAmount,
            method: "카드 (자동결제)",
            approvedAt: data.approvedAt,
        });

        try {
            const subscription = await getSubscription(userId);
            if (subscription) {
                const billingCycle = subscription.billingCycle || "monthly";
                await saveSubscription(userId, {
                    ...subscription,
                    status: "active",
                    nextBillingDate: getNextBillingDate(billingCycle),
                });
            }
        } catch (err) {
            console.error(
                "Failed to update subscription after billing payment:",
                err
            );
        }
    }
}

// Handle failed recurring payment
async function handleBillingPaymentFailed(data: any) {
    console.log("❌ Recurring payment failed:", data);

    const userId = extractUserId(data.customerKey);

    if (userId) {
        // Update subscription status
        const subscription = await getSubscription(userId);
        if (subscription) {
            await saveSubscription(userId, {
                ...subscription,
                status: "expired",
            });
        }

        await sendPaymentFailureNotification(userId, {
            orderId: data.orderId,
            failReason: data.failReason,
            isRecurring: true,
        });
    }
}

// Extract user ID from customer key
function extractUserId(customerKey: string): string | null {
    // customerKey format: "customer_{email}_{timestamp}" or user ID
    // Extract the actual user ID from your format
    const parts = customerKey.split("_");
    if (parts.length > 1) {
        return parts[1]; // Adjust based on your format
    }
    return customerKey;
}
