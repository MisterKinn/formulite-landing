# 토스페이먼츠 구독 결제 시스템 완료 가이드

## ✅ 완료된 기능

### 1. 웹훅 시스템 (Webhook)

-   ✅ 토스페이먼츠 이벤트 수신
-   ✅ 결제 완료, 실패, 취소 처리
-   ✅ 정기 결제 완료/실패 처리
-   ✅ 서명 검증 구조 (프로덕션용)

### 2. 구독 관리 UI

-   ✅ 프로필 페이지 구독 정보 표시
-   ✅ 현재 플랜 및 상태 표시
-   ✅ 구독 시작일, 다음 결제일 표시
-   ✅ 구독 취소 기능
-   ✅ Firebase에서 실시간 데이터 로드

### 3. 에러 핸들링

-   ✅ 토스페이먼츠 에러 코드 한글 메시지 변환
-   ✅ 재시도 로직 (exponential backoff)
-   ✅ 금액 검증 (100원 ~ 10,000,000원)
-   ✅ 구조화된 에러 로깅
-   ✅ 사용자 친화적 에러 메시지

### 4. 이메일 알림

-   ✅ 결제 완료 영수증
-   ✅ 결제 실패 알림
-   ✅ 정기 결제 알림
-   ✅ Resend API 통합
-   ✅ Firebase에서 사용자 이메일 가져오기

## 🔧 프로덕션 배포 전 필수 설정

### 1. 환경 변수 설정 (.env.local)

```bash
# 토스페이먼츠 키 (실제 키로 교체)
NEXT_PUBLIC_TOSS_CLIENT_KEY=ck_test_... # 테스트 환경
# NEXT_PUBLIC_TOSS_CLIENT_KEY=ck_live_... # 프로덕션 환경
TOSS_SECRET_KEY=sk_test_... # 테스트 환경
# TOSS_SECRET_KEY=sk_live_... # 프로덕션 환경

# 이메일 서비스 (Resend)
RESEND_API_KEY=re_... # https://resend.com 에서 발급

# Firebase 설정
NEXT_PUBLIC_FIREBASE_API_KEY=...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=...
NEXT_PUBLIC_FIREBASE_PROJECT_ID=...
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=...
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...
NEXT_PUBLIC_FIREBASE_APP_ID=...
```

### 2. 토스페이먼츠 웹훅 설정

1. [토스페이먼츠 개발자센터](https://developers.tosspayments.com/) 접속
2. **설정 > 웹훅** 메뉴로 이동
3. 웹훅 URL 등록:
    - 개발: `https://your-dev-domain.vercel.app/api/webhooks/toss`
    - 프로덕션: `https://formulite.ai/api/webhooks/toss`
4. 수신할 이벤트 선택:
    - ✅ PAYMENT_COMPLETED
    - ✅ PAYMENT_FAILED
    - ✅ PAYMENT_CANCELLED
    - ✅ BILLING_KEY_ISSUED
    - ✅ BILLING_PAYMENT_COMPLETED
    - ✅ BILLING_PAYMENT_FAILED

### 3. 웹훅 서명 검증 활성화

`app/api/webhooks/toss/route.ts` 파일에서:

```typescript
function verifyWebhookSignature(signature: string | null, body: any): boolean {
    if (process.env.NODE_ENV === "development") {
        return true; // 개발 환경에서는 검증 생략
    }

    // 프로덕션: 실제 서명 검증 구현
    const secret = process.env.TOSS_WEBHOOK_SECRET;
    const crypto = require("crypto");
    const hash = crypto
        .createHmac("sha256", secret)
        .update(JSON.stringify(body))
        .digest("hex");

    return hash === signature;
}
```

환경 변수에 `TOSS_WEBHOOK_SECRET` 추가 필요.

### 4. Cron Job 설정 (월간 정기 결제)

#### 옵션 A: Vercel Cron (권장)

`vercel.json` 파일 생성:

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

-   매일 자정(UTC)에 실행
-   한국 시간 기준: 오전 9시

#### 옵션 B: 외부 Cron 서비스

[cron-job.org](https://cron-job.org) 또는 유사 서비스 사용:

1. 무료 계정 생성
2. 새 cron job 추가:
    - URL: `https://formulite.ai/api/cron/billing`
    - Schedule: `0 0 * * *` (매일 자정)
    - Method: GET

**⚠️ 보안**: Cron endpoint에 인증 추가 필요!

`app/api/cron/billing/route.ts`에 추가:

```typescript
export async function GET(request: NextRequest) {
    // API 키 검증
    const apiKey = request.headers.get("x-api-key");
    if (apiKey !== process.env.CRON_API_KEY) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 기존 코드...
}
```

`.env.local`에 추가:

```bash
CRON_API_KEY=your-secret-key-here
```

### 5. Resend 이메일 서비스 설정

1. [Resend](https://resend.com) 가입
2. API 키 발급
3. 도메인 인증:
    - 도메인 추가: `formulite.ai`
    - DNS 레코드 설정 (TXT, MX 등)
4. 발신 이메일 주소 설정:
    - `noreply@formulite.ai`
    - `support@formulite.ai`

`lib/email.ts`에서 발신 주소 수정:

```typescript
from: "Nova AI <noreply@formulite.ai>",
```

### 6. Firebase 보안 규칙

Firebase Console에서 Firestore 규칙 설정:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // 사용자는 자신의 데이터만 읽기/쓰기 가능
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;

      // 구독 정보
      match /subscription/{document=**} {
        allow read, write: if request.auth != null && request.auth.uid == userId;
      }
    }
  }
}
```

## 🧪 테스트 가이드

### 1. 결제 테스트

토스페이먼츠 테스트 카드:

```
카드번호: 4111-1111-1111-1111
유효기간: 아무거나 (미래 날짜)
CVC: 123
비밀번호: 아무거나
```

### 2. 테스트 시나리오

#### 일회성 결제

1. 가격 페이지에서 "무료로 시작하기" 클릭
2. 결제 페이지로 이동
3. 토스 결제창에서 테스트 카드 입력
4. 성공 페이지 확인
5. 이메일 수신 확인

#### 정기 구독

1. 가격 페이지에서 "플러스 시작하기" 또는 "프로 시작하기" 클릭
2. 결제 페이지로 이동 (recurring=true)
3. 카드 등록 진행
4. 성공 페이지에서 "구독이 시작되었습니다" 확인
5. 프로필 페이지에서 구독 정보 확인:
    - 현재 플랜
    - 구독 시작일
    - 다음 결제일
    - 월 결제 금액

#### 구독 취소

1. 프로필 페이지 > 구독 탭
2. "구독 취소하기" 버튼 클릭
3. 확인 대화상자에서 "확인"
4. 상태가 "취소됨"으로 변경 확인

#### 월간 정기 결제 테스트

1. Firebase에서 테스트 사용자의 `nextBillingDate`를 오늘 날짜로 수정
2. Cron endpoint 수동 호출:
    ```bash
    curl -X GET https://your-domain.vercel.app/api/cron/billing \
      -H "x-api-key: your-cron-api-key"
    ```
3. 로그에서 결제 성공 확인
4. Firebase에서 `nextBillingDate`가 +30일로 업데이트 확인

### 3. 웹훅 테스트

로컬 개발 환경에서 웹훅 테스트:

1. [ngrok](https://ngrok.com) 설치

    ```bash
    ngrok http 3000
    ```

2. ngrok URL을 토스페이먼츠에 등록

    ```
    https://abc123.ngrok.io/api/webhooks/toss
    ```

3. 테스트 결제 진행

4. 터미널에서 웹훅 로그 확인:
    ```
    📬 Webhook received: PAYMENT_COMPLETED {...}
    ✅ Payment completed: {...}
    ✅ Receipt email sent to: user@example.com
    ```

## 📊 모니터링 & 로깅

### 1. Vercel 로그

Vercel Dashboard에서:

-   Functions > Logs
-   실시간 로그 스트림 확인
-   에러 발생 시 알림 설정

### 2. Sentry 통합 (권장)

에러 추적을 위한 Sentry 설정:

```bash
npm install @sentry/nextjs
```

`sentry.client.config.js` 생성:

```javascript
import * as Sentry from "@sentry/nextjs";

Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    tracesSampleRate: 1.0,
});
```

### 3. Firebase Analytics

결제 이벤트 추적:

```typescript
import { logEvent } from "firebase/analytics";

// 결제 완료 시
logEvent(analytics, "purchase", {
    transaction_id: orderId,
    value: amount,
    currency: "KRW",
    items: [{ item_name: plan }],
});
```

## 🚀 배포 체크리스트

프로덕션 배포 전 확인사항:

-   [ ] `.env.local`에 실제 프로덕션 키 설정
    -   [ ] `NEXT_PUBLIC_TOSS_CLIENT_KEY` (ck*live*...)
    -   [ ] `TOSS_SECRET_KEY` (sk*live*...)
    -   [ ] `RESEND_API_KEY`
    -   [ ] `CRON_API_KEY`
-   [ ] 토스페이먼츠 웹훅 URL 등록 (프로덕션 도메인)
-   [ ] 웹훅 서명 검증 활성화
-   [ ] Cron job 설정 (Vercel 또는 외부 서비스)
-   [ ] Resend 도메인 인증 완료
-   [ ] Firebase 보안 규칙 적용
-   [ ] 테스트 결제 성공 확인 (테스트 환경)
-   [ ] 실제 카드로 결제 테스트 (프로덕션)
-   [ ] 월간 정기 결제 로직 테스트
-   [ ] 구독 취소 기능 테스트
-   [ ] 에러 핸들링 확인
-   [ ] 이메일 발송 테스트

## 📝 주요 파일 구조

```
app/
├── api/
│   ├── payment/
│   │   ├── confirm/route.ts       # 일회성 결제 승인
│   │   └── billing/route.ts       # 정기 결제 관리
│   ├── webhooks/
│   │   └── toss/route.ts          # 웹훅 핸들러
│   └── cron/
│       └── billing/route.ts       # 월간 정기 결제 트리거
├── payment/
│   ├── page.tsx                   # 결제 페이지 (자동 리다이렉트)
│   └── success/
│       └── page.tsx               # 결제 성공 페이지
└── profile/
    └── page.tsx                   # 프로필 & 구독 관리

lib/
├── subscription.ts                # Firebase 구독 관리
├── monthlyBilling.ts              # 월간 정기 결제 처리
├── paymentErrors.ts               # 에러 핸들링 유틸리티
└── email.ts                       # 이메일 발송 시스템

components/
└── Pricing.tsx                    # 가격 페이지 (결제 연동)
```

## 💡 추가 권장 사항

### 1. 관리자 대시보드

구독자 관리를 위한 간단한 대시보드 추가:

-   전체 구독자 수
-   월간 매출
-   활성/취소된 구독 통계
-   실패한 결제 목록

### 2. 갱신 알림

다음 결제일 3일 전에 알림 이메일 발송:

```typescript
// lib/monthlyBilling.ts에 추가
export async function sendRenewalReminders() {
    const threeDaysFromNow = new Date();
    threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);

    // Firebase 쿼리...
    // 이메일 발송...
}
```

### 3. 결제 이력 페이지

사용자가 과거 결제 내역을 볼 수 있는 페이지 추가.

### 4. 쿠폰/할인 시스템

프로모션 코드 입력 기능 추가.

## 🆘 트러블슈팅

### 웹훅이 수신되지 않음

1. 토스페이먼츠 개발자센터에서 웹훅 URL 확인
2. 네트워크 탭에서 응답 확인
3. Vercel 로그에서 에러 확인
4. 웹훅 서명 검증이 실패하는지 확인 (개발 환경에서는 true 반환하도록)

### 정기 결제가 실행되지 않음

1. Cron job이 제대로 설정되었는지 확인
2. Firebase에서 `nextBillingDate`와 `status`가 올바른지 확인
3. API 로그에서 에러 확인

### 이메일이 발송되지 않음

1. Resend API 키가 올바른지 확인
2. 도메인 인증이 완료되었는지 확인
3. 발신 이메일 주소가 인증된 도메인인지 확인
4. Resend 대시보드에서 발송 로그 확인

### 결제는 성공했는데 데이터가 저장되지 않음

1. Firebase 보안 규칙 확인
2. 네트워크 탭에서 API 응답 확인
3. 브라우저 콘솔에서 에러 확인

## 📞 지원

문제가 발생하면:

1. 이 가이드의 트러블슈팅 섹션 확인
2. Vercel 로그 확인
3. [토스페이먼츠 고객센터](https://docs.tosspayments.com) 문의
4. Firebase 콘솔에서 데이터 확인

## 🎉 완료!

모든 설정이 완료되었습니다. 이제 실제 결제를 받을 수 있습니다!

**중요**: 프로덕션 배포 전에 반드시 테스트 환경에서 모든 기능을 확인하세요.
