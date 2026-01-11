# API 엔드포인트 레퍼런스

## 결제 API

### 1. 결제 승인 (일회성)

**Endpoint**: `POST /api/payment/confirm`

**Request Body**:

```json
{
  "paymentKey": "string",
  "orderId": "string",
  "amount": number
}
```

**Response**:

```json
{
    "success": true,
    "data": {
        "orderId": "...",
        "totalAmount": 9900,
        "method": "카드",
        "approvedAt": "2024-01-15T10:30:00"
    }
}
```

**Error Response**:

```json
{
    "error": "결제 승인에 실패했습니다",
    "code": "INVALID_CARD_NUMBER"
}
```

---

### 2. 빌링키 저장 (정기 결제)

**Endpoint**: `POST /api/payment/billing`

**Request Body**:

```json
{
    "authKey": "billing_key_abc123",
    "customerKey": "customer_test@example.com_1234567890",
    "userId": "firebase_user_id",
    "plan": "plus",
    "amount": 9900
}
```

**Response**:

```json
{
    "success": true,
    "message": "Subscription activated"
}
```

---

### 3. 정기 결제 실행

**Endpoint**: `PUT /api/payment/billing`

**Request Body**:

```json
{
    "billingKey": "billing_key_abc123",
    "customerKey": "customer_test@example.com_1234567890",
    "amount": 9900,
    "orderId": "order_1234567890",
    "orderName": "Nova AI 플러스 요금제"
}
```

**Response**:

```json
{
    "success": true,
    "data": {
        "orderId": "order_1234567890",
        "totalAmount": 9900,
        "status": "DONE"
    }
}
```

---

## 웹훅 API

### 4. 토스페이먼츠 웹훅

**Endpoint**: `POST /api/webhooks/toss`

**Headers**:

```
toss-signature: webhook_signature_here
Content-Type: application/json
```

**Request Body**:

```json
{
    "eventType": "PAYMENT_COMPLETED",
    "data": {
        "paymentKey": "...",
        "orderId": "...",
        "totalAmount": 9900,
        "method": "카드",
        "approvedAt": "2024-01-15T10:30:00",
        "customerKey": "customer_..."
    }
}
```

**이벤트 타입**:

-   `PAYMENT_COMPLETED`: 일회성 결제 완료
-   `PAYMENT_FAILED`: 결제 실패
-   `PAYMENT_CANCELLED`: 결제 취소
-   `BILLING_KEY_ISSUED`: 빌링키 발급
-   `BILLING_PAYMENT_COMPLETED`: 정기 결제 완료
-   `BILLING_PAYMENT_FAILED`: 정기 결제 실패

**Response**:

```json
{
    "success": true
}
```

---

## Cron API

### 5. 월간 정기 결제 실행

**Endpoint**: `GET /api/cron/billing`

**Headers**:

```
x-api-key: your-cron-api-key
```

**Response**:

```json
{
    "success": true,
    "processed": 42,
    "succeeded": 40,
    "failed": 2
}
```

---

## Firebase 데이터 구조

### 사용자 구독 정보

**컬렉션**: `users/{userId}/subscription`

**문서 구조**:

```typescript
{
  plan: "free" | "plus" | "pro",
  billingKey: "billing_key_abc123",
  customerKey: "customer_test@example.com_1234567890",
  startDate: "2024-01-15T10:30:00.000Z",
  nextBillingDate: "2024-02-15T10:30:00.000Z",
  status: "active" | "cancelled" | "expired",
  amount: 9900
}
```

---

## 에러 코드 매핑

### 토스페이먼츠 에러 코드

| 코드                             | 한글 메시지                       |
| -------------------------------- | --------------------------------- |
| `INVALID_CARD_NUMBER`            | 유효하지 않은 카드 번호입니다     |
| `INVALID_CARD_EXPIRATION`        | 카드 유효기간이 올바르지 않습니다 |
| `INVALID_CARD_CVC`               | CVC 번호가 올바르지 않습니다      |
| `INVALID_STOPPED_CARD`           | 정지된 카드입니다                 |
| `EXCEED_MAX_CARD_LIMIT`          | 카드 한도를 초과했습니다          |
| `INVALID_CARD_INSTALLMENT`       | 할부가 불가능한 카드입니다        |
| `NOT_SUPPORTED_CARD`             | 지원하지 않는 카드입니다          |
| `INSUFFICIENT_BALANCE`           | 잔액이 부족합니다                 |
| `EXCEED_MAX_DAILY_PAYMENT_COUNT` | 일일 결제 한도를 초과했습니다     |
| `NOT_ALLOWED_PAYMENT_TYPE`       | 허용되지 않은 결제 수단입니다     |
| `ALREADY_PROCESSED_PAYMENT`      | 이미 처리된 결제입니다            |

더 많은 에러 코드는 `lib/paymentErrors.ts` 참고

---

## 테스트 데이터

### 테스트 카드

```
카드번호: 4111-1111-1111-1111
유효기간: 12/25 (미래 날짜 아무거나)
CVC: 123
비밀번호: 1234 (아무거나)
```

### 테스트 사용자

```typescript
{
  userId: "test_user_123",
  email: "test@example.com",
  plan: "plus",
  amount: 9900
}
```

### CustomerKey 형식

```
customer_{email}_{timestamp}
예: customer_test@example.com_1705315800000
```

---

## 프론트엔드 통합

### 결제 페이지 URL

#### 일회성 결제

```
/payment?amount=9900&orderName=Nova AI 플러스 요금제
```

#### 정기 구독

```
/payment?amount=9900&orderName=Nova AI 플러스 요금제&recurring=true
```

### 성공 URL (자동 리다이렉트)

#### 일회성 결제

```
/payment/success?paymentKey={PAYMENT_KEY}&orderId={ORDER_ID}&amount={AMOUNT}
```

#### 정기 구독

```
/payment/success?billing=true&authKey={AUTH_KEY}&customerKey={CUSTOMER_KEY}&orderId={ORDER_ID}
```

### 실패 URL

```
/payment/fail?code={ERROR_CODE}&message={ERROR_MESSAGE}
```

---

## 구독 상태 관리

### 상태 전이도

```
free → (결제) → active → (취소) → cancelled
                ↓
             expired (결제 실패)
```

### 상태별 동작

-   **free**: 무료 플랜, 기본 기능만 사용 가능
-   **active**: 정기 결제 활성화, 모든 기능 사용 가능
-   **cancelled**: 사용자가 취소, 다음 결제일까지 사용 가능
-   **expired**: 결제 실패로 만료, 무료 플랜으로 다운그레이드

---

## 보안 고려사항

### 1. API 키 보호

-   클라이언트: `NEXT_PUBLIC_TOSS_CLIENT_KEY` (공개 가능)
-   서버: `TOSS_SECRET_KEY` (절대 공개 금지)

### 2. 웹훅 검증

```typescript
const signature = request.headers.get("toss-signature");
if (!verifyWebhookSignature(signature, body)) {
    return 401;
}
```

### 3. Cron 엔드포인트 보호

```typescript
const apiKey = request.headers.get("x-api-key");
if (apiKey !== process.env.CRON_API_KEY) {
    return 401;
}
```

### 4. Firebase 보안 규칙

사용자는 자신의 데이터만 읽기/쓰기 가능

---

## 모니터링

### 로그 위치

-   **Vercel**: Dashboard > Functions > Logs
-   **Firebase**: Console > Firestore > Data
-   **Resend**: Dashboard > Emails

### 중요 로그 메시지

```
✅ Payment completed: {...}
✅ Receipt email sent to: user@example.com
❌ Payment failed: {...}
📬 Webhook received: PAYMENT_COMPLETED
🔄 Processing monthly billing for 42 users
```

---

## 참고 자료

-   [토스페이먼츠 개발자 문서](https://docs.tosspayments.com)
-   [Resend API 문서](https://resend.com/docs)
-   [Firebase 문서](https://firebase.google.com/docs)
-   [Vercel Cron 가이드](https://vercel.com/docs/cron-jobs)
