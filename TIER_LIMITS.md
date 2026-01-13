# AI Call Tier Limits

This system tracks and limits AI API calls based on the user's subscription tier.

## Tier Limits

| Tier  | Monthly AI Call Limit |
| ----- | --------------------- |
| Free  | 3 calls               |
| Basic | 100 calls             |
| Plus  | 300 calls             |
| Pro   | 1000 calls            |

## Firebase Structure

Each user document in `users/{userId}` contains:

```typescript
{
  plan: "free" | "basic" | "plus" | "pro",
  aiCallUsage: number,  // Current usage count
  lastAiCallAt: string, // ISO timestamp of last call
  usageResetAt: string  // ISO timestamp of last reset
}
```

## API Endpoints

### Check Usage Limit

```
GET /api/ai/check-limit?userId={userId}
```

Response:

```json
{
    "success": true,
    "plan": "basic",
    "currentUsage": 45,
    "limit": 100,
    "remaining": 55,
    "canUse": true
}
```

### Increment Usage

```
POST /api/ai/increment-usage
Body: { "userId": "user123" }
```

Response:

```json
{
    "success": true,
    "currentUsage": 46,
    "limit": 100,
    "remaining": 54
}
```

If limit exceeded (HTTP 429):

```json
{
    "success": false,
    "error": "Usage limit exceeded",
    "currentUsage": 100,
    "limit": 100
}
```

### Reset Usage (Admin Only)

```
POST /api/ai/reset-usage
Headers: { "Authorization": "Bearer YOUR_ADMIN_SECRET" }
Body: { "userId": "user123" }
```

Response:

```json
{
    "success": true,
    "message": "Usage reset successfully"
}
```

## Usage Example

See `/app/api/ai/generate/route.ts` for a complete example of how to integrate the limit system:

```typescript
// 1. Check if user can make a call
const checkResponse = await fetch(`/api/ai/check-limit?userId=${userId}`);
const limitCheck = await checkResponse.json();

if (!limitCheck.canUse) {
    return { error: "Usage limit exceeded" };
}

// 2. Perform your AI operation
const aiResult = await yourAIService(prompt);

// 3. Increment usage counter
await fetch("/api/ai/increment-usage", {
    method: "POST",
    body: JSON.stringify({ userId }),
});
```

## Profile Page

The profile page (`/profile?tab=subscription`) displays:

-   Current plan tier
-   Usage: X / Y calls used
-   Visual progress bar
-   Warning when limit is reached

## Plan Upgrades

When a user upgrades their plan:

1. The `plan` field is automatically updated in Firebase (see `/app/api/billing/issue/route.ts`)
2. The `aiCallUsage` is preserved (not reset)
3. The new limit is immediately available

## Monthly Reset

To implement monthly resets, create a scheduled job (Vercel Cron or similar) that calls `/api/ai/reset-usage` for all users monthly. The cron job should:

1. Query all users from Firestore
2. Call `/api/ai/reset-usage` for each user with admin authorization
3. Log results

Example cron schedule: `0 0 1 * *` (first day of each month at midnight)

## Configuration

Tier limits are defined in `/lib/tierLimits.ts`:

```typescript
export const TIER_LIMITS = {
    free: 3,
    basic: 100,
    plus: 300,
    pro: 1000,
} as const;
```

## Security

-   All API endpoints validate `userId` parameter
-   Reset endpoint requires admin authorization via `ADMIN_SECRET` environment variable
-   Firebase security rules should restrict direct access to user documents
