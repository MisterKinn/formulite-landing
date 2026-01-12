# 🎯 토스페이먼츠 월간 구독 결제 시스템

## ✅ 완성된 기능들

### 1. 🛒 클라이언트 결제 플로우

-   **프로필 페이지**: 월간/연간 구독 선택 가능
-   **결제 페이지**: 토스페이먼츠 SDK로 일회성/정기결제 처리
-   **성공 페이지**: 구독 등록 확인 및 다음 결제일 표시

### 2. 🔄 서버 웹훅 처리

-   **BILLING_KEY_ISSUED**: 빌링키 발급 시 구독 정보 저장
-   **BILLING_PAYMENT_COMPLETED**: 정기결제 완료 시 다음 결제일 갱신
-   **PAYMENT_COMPLETED**: 일회성 결제 완료 처리
-   **PAYMENT_CANCELLED**: 결제 취소 시 상태 업데이트

### 3. 📊 데이터베이스 구조

```typescript
// users/{userId}.subscription
{
  plan: "free" | "plus" | "pro",
  billingKey?: string,        // 정기결제용 빌링키
  customerKey?: string,       // 토스 고객키
  isRecurring: boolean,       // 정기결제 여부
  billingCycle?: "monthly" | "yearly", // 결제 주기
  productId?: string,         // 상품 ID
  subscriptionId?: string,    // 구독 ID
  startDate: string,
  nextBillingDate?: string,   // 다음 결제 예정일
  status: "active" | "cancelled" | "expired" | "suspended",
  amount?: number
}
```

### 4. ⏰ 자동 결제 스케줄러

-   **매일 오전 9시** Vercel Cron으로 자동 실행
-   결제 예정일 지난 구독들을 자동으로 처리
-   실패 시 재시도 로직 및 구독 일시정지

## 🚀 사용법

### 1. 환경변수 설정

```env
# 토스페이먼츠
NEXT_PUBLIC_TOSS_CLIENT_KEY=test_ck_***
TOSS_SECRET_KEY=test_sk_***

# 스케줄링 보안
CRON_SECRET=your-secure-cron-secret
ADMIN_SECRET=your-admin-secret
```

### 2. 테스트 시나리오

#### A. 월간 구독 등록 테스트

1. `/profile` 페이지에서 "월간" 선택 후 구독
2. 토스 빌링 인증 완료
3. 웹훅으로 `BILLING_KEY_ISSUED` 처리 확인
4. Firestore에서 `isRecurring: true`, `billingCycle: "monthly"` 확인

#### B. 자동 결제 테스트

```bash
# 수동으로 스케줄러 실행
curl -X POST "http://localhost:3000/api/billing/scheduled" \
  -H "Authorization: Bearer your-cron-secret"

# 특정 사용자 즉시 결제
curl -X POST "http://localhost:3000/api/billing/user/{userId}" \
  -H "Authorization: Bearer your-admin-secret"
```

#### C. 웹훅 시뮬레이션

```bash
# 빌링키 발급
curl -X POST "http://localhost:3000/api/webhooks/toss" \
  -H "Content-Type: application/json" \
  -d '{
    "eventType": "BILLING_KEY_ISSUED",
    "data": {
      "customerKey": "customer_userId_123",
      "billingKey": "bkey_test123",
      "metadata": { "billingCycle": "monthly" },
      "totalAmount": 9900
    }
  }'

# 정기결제 완료
curl -X POST "http://localhost:3000/api/webhooks/toss" \
  -H "Content-Type: application/json" \
  -d '{
    "eventType": "BILLING_PAYMENT_COMPLETED",
    "data": {
      "customerKey": "customer_userId_123",
      "orderId": "recurring_test123",
      "totalAmount": 9900
    }
  }'
```

## 📁 새로 추가된 파일들

1. **lib/scheduledBilling.ts** - 자동 결제 스케줄러 로직
2. **app/api/billing/scheduled/route.ts** - 스케줄러 API 엔드포인트
3. **app/api/billing/user/[userId]/route.ts** - 개별 사용자 즉시 결제
4. **vercel.json** - Vercel Cron 설정

## 🔧 개선된 기능들

1. **PaymentClient.tsx** - billingCycle을 metadata에 포함하여 웹훅에서 정확한 주기 처리
2. **webhooks/toss/route.ts** - metadata에서 billingCycle 추출하는 로직 개선
3. **payment/success/page.tsx** - 구독 등록 성공 시 더 명확한 안내 메시지

## 🔒 보안 고려사항

1. **웹훅 서명 검증**: 프로덕션에서 토스 시크릿으로 검증 필요
2. **API 인증**: CRON_SECRET, ADMIN_SECRET으로 엔드포인트 보호
3. **고객키 생성**: UUID 기반으로 충분히 무작위값 사용

## 🎯 다음 단계

1. **이메일 알림**: 결제 성공/실패 시 고객 알림
2. **관리자 대시보드**: 구독 현황 모니터링
3. **고객 포털**: 구독 관리, 결제 수단 변경
4. **분석**: 구독 지표 및 매출 분석

---

이제 **완전한 월간/연간 구독 결제 시스템**이 준비되었습니다! 🚀
