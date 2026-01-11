# Nova AI Payment & Subscription System

## Overview

Automated monthly billing system using Toss Payments with Firebase storage.

## Features

-   ✅ Billing key storage in Firebase
-   ✅ Monthly recurring payments
-   ✅ User plan management (free, plus, pro)
-   ✅ Automatic subscription activation

## Data Structure

### Firebase `users` collection:

```json
{
  "userId": {
    "subscription": {
      "plan": "plus" | "pro" | "free",
      "billingKey": "billing_key_from_toss",
      "customerKey": "customer_unique_id",
      "startDate": "2026-01-11T00:00:00.000Z",
      "nextBillingDate": "2026-02-11T00:00:00.000Z",
      "status": "active" | "cancelled" | "expired",
      "amount": 9900
    },
    "updatedAt": "2026-01-11T00:00:00.000Z"
  }
}
```

## API Endpoints

### 1. `/api/payment/billing` (POST)

Save billing key after successful billing auth

```json
{
    "authKey": "billing_key",
    "customerKey": "customer_id",
    "userId": "firebase_uid",
    "plan": "plus",
    "amount": 9900
}
```

### 2. `/api/payment/billing` (PUT)

Charge monthly billing

```json
{
    "billingKey": "saved_billing_key",
    "customerKey": "customer_id",
    "amount": 9900,
    "orderId": "order_123",
    "orderName": "Nova AI 플러스 월간 구독"
}
```

### 3. `/api/cron/billing` (POST)

Manually trigger monthly billing process (should be automated with cron)

## Monthly Billing Process

### Automatic (Recommended):

Set up a cron job to call `/api/cron/billing` daily:

**Vercel Cron (vercel.json):**

```json
{
    "crons": [
        {
            "path": "/api/cron/billing",
            "schedule": "0 0 * * *"
        }
    ]
}
```

**Or use external cron service:**

-   [cron-job.org](https://cron-job.org)
-   [EasyCron](https://www.easycron.com)
-   AWS EventBridge
-   Google Cloud Scheduler

### Manual Testing:

```bash
curl -X POST http://localhost:3000/api/cron/billing
```

## Environment Variables

Add to `.env.local`:

```env
# Toss Payments (already exists)
NEXT_PUBLIC_TOSS_CLIENT_KEY=live_ck_...
TOSS_SECRET_KEY=live_sk_...

# App URL (for billing callbacks)
NEXT_PUBLIC_APP_URL=https://your-domain.com
```

## User Flow

### 1. User clicks upgrade button

→ Redirects to `/payment?amount=9900&orderName=Nova AI 플러스 요금제&recurring=true`

### 2. Payment page loads

→ Calls `tossPayments.requestBillingAuth()` for card registration

### 3. User registers card

→ Toss redirects to `/payment/success?authKey=xxx&customerKey=xxx&billing=true`

### 4. Success page saves subscription

→ Calls `/api/payment/billing` (POST) to save billing key to Firebase
→ Updates user plan to "plus" or "pro"

### 5. Monthly billing runs

→ Cron job calls `/api/cron/billing` daily
→ System checks users with `nextBillingDate <= today`
→ Charges each user via `/api/payment/billing` (PUT)
→ Updates `nextBillingDate` to +30 days

## Testing

### Test Billing Flow:

1. Use Toss test keys in `.env.local`
2. Click upgrade button
3. Enter test card: `4111-1111-1111-1111`
4. Check Firebase for saved subscription data
5. Manually trigger billing: `POST /api/cron/billing`
6. Verify billing was processed

### Test Cards (Toss Payments):

-   Success: `4111-1111-1111-1111`
-   Insufficient funds: `5555-5555-5555-5555`
-   Invalid card: `4000-0000-0000-0002`

## Security Notes

⚠️ **Important:**

-   Billing keys are stored in Firebase (encrypted at rest)
-   Never store billing keys in `.env.local` (they're user-specific)
-   Secret key (`TOSS_SECRET_KEY`) stays server-only
-   Add authentication to `/api/cron/billing` in production
-   Implement webhook validation for Toss callbacks

## Next Steps

1. ✅ Test billing flow with Toss test cards
2. ⏳ Set up Vercel cron or external scheduler
3. ⏳ Add webhook handler for payment notifications
4. ⏳ Implement subscription cancellation
5. ⏳ Add email notifications (receipts, failures)
6. ⏳ Create admin dashboard for monitoring
7. ⏳ Add retry logic for failed payments

## Troubleshooting

**Billing not working?**

-   Check Firebase rules allow write to `users/{userId}/subscription`
-   Verify `TOSS_SECRET_KEY` is set correctly
-   Check cron job is running (logs in Vercel dashboard)

**User plan not updating?**

-   Check Firebase Security Rules
-   Verify user is logged in (`useAuth` hook)
-   Check browser console for errors

**Need help?**
See Toss Payments docs: https://docs.tosspayments.com/
