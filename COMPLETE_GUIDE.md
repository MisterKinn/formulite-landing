# 🎯 토스페이먼츠 월간 구독 시스템 - 완벽 가이드

## 📋 시스템 개요

완전한 토스페이먼츠 기반 월간/연간 구독 결제 시스템이 구현되었습니다.

### ✅ 구현된 기능

-   ✅ 카드 등록 (빌링키 발급)
-   ✅ 월간/연간 구독 시작
-   ✅ 자동 결제 스케줄링
-   ✅ 웹훅 이벤트 처리
-   ✅ 구독 관리 대시보드
-   ✅ 실패 처리 및 재시도

---

## 🚀 단계별 사용법

### 1단계: 환경 설정 확인

`.env.local` 파일이 올바르게 설정되었는지 확인:

```env
# 토스페이먼츠 (필수)
NEXT_PUBLIC_TOSS_CLIENT_KEY=test_gck_***
TOSS_SECRET_KEY=test_gsk_***

# 스케줄링 및 보안 (필수)
CRON_SECRET=cron_secret_12345_secure
ADMIN_SECRET=admin_secret_67890_secure
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### 2단계: 개발 서버 시작

```bash
npm run dev
# 또는
yarn dev
```

### 3단계: 카드 등록 테스트

1. **카드 등록 페이지 접속**: `http://localhost:3000/card-registration`
2. **로그인**: Firebase 인증으로 로그인
3. **카드 등록**: "🔒 카드 등록하기" 버튼 클릭
4. **테스트 카드 사용**:
    - 카드번호: `4000-0000-0000-0002`
    - 만료일: `12/28`
    - CVC: `123`
    - 비밀번호: `00`
5. **성공 확인**: `/card-registration/success` 페이지로 리다이렉트

### 4단계: 구독 시작 테스트

1. **구독 대시보드 접속**: `http://localhost:3000/subscription`
2. **플랜 선택**: 플러스(9,900원) 또는 프로(29,900원)
3. **결제 주기 선택**: 월간 또는 연간
4. **구독 시작**: 결제 완료 후 구독 활성화 확인

### 5단계: 자동 결제 테스트

#### A. 즉시 테스트

1. 구독 대시보드에서 "테스트 결제 실행" 버튼 클릭
2. 결제 성공/실패 확인
3. 다음 결제일 갱신 확인

#### B. API 직접 호출

```bash
# 특정 사용자 즉시 결제
curl -X POST "http://localhost:3000/api/billing/user/{userId}" \
  -H "Authorization: Bearer admin_secret_67890_secure" \
  -H "Content-Type: application/json"

# 스케줄된 모든 결제 실행
curl -X POST "http://localhost:3000/api/billing/scheduled" \
  -H "Authorization: Bearer cron_secret_12345_secure"
```

### 6단계: 웹훅 테스트

```bash
# 빌링키 발급 시뮬레이션
curl -X POST "http://localhost:3000/api/webhooks/toss" \
  -H "Content-Type: application/json" \
  -d '{
    "eventType": "BILLING_KEY_ISSUED",
    "data": {
      "customerKey": "customer_사용자ID_123",
      "billingKey": "bkey_test123",
      "metadata": { "billingCycle": "monthly" },
      "totalAmount": 9900
    }
  }'

# 정기결제 완료 시뮬레이션
curl -X POST "http://localhost:3000/api/webhooks/toss" \
  -H "Content-Type: application/json" \
  -d '{
    "eventType": "BILLING_PAYMENT_COMPLETED",
    "data": {
      "customerKey": "customer_사용자ID_123",
      "orderId": "recurring_test123",
      "totalAmount": 9900
    }
  }'

# 결제 취소 시뮬레이션
curl -X POST "http://localhost:3000/api/webhooks/toss" \
  -H "Content-Type: application/json" \
  -d '{
    "eventType": "PAYMENT_CANCELLED",
    "data": {
      "customerKey": "customer_사용자ID_123",
      "orderId": "order_test123"
    }
  }'
```

---

## 📁 새로 추가된 페이지 및 API

### 🖥️ 프론트엔드 페이지

-   `/card-registration` - 카드 등록
-   `/card-registration/success` - 카드 등록 성공
-   `/card-registration/fail` - 카드 등록 실패
-   `/subscription` - 구독 관리 대시보드

### 🔌 API 엔드포인트

-   `POST /api/billing/issue` - 빌링키 발급
-   `PUT /api/billing/charge` - 자동 결제
-   `POST /api/billing/scheduled` - 스케줄된 결제 실행
-   `POST /api/billing/user/[userId]` - 개별 사용자 즉시 결제

### ⏰ 자동화

-   `vercel.json` - 매일 오전 9시 자동 결제 실행

---

## 🔍 데이터 확인 방법

### Firebase Firestore 구조

```
users/{userId}/
├── subscription: {
│   ├── billingKey: "bkey_***" (카드 등록 시)
│   ├── customerKey: "customer_***"
│   ├── isRecurring: true/false
│   ├── billingCycle: "monthly"/"yearly"
│   ├── plan: "plus"/"pro"
│   ├── status: "active"/"suspended"/"cancelled"
│   ├── nextBillingDate: "2026-02-12"
│   ├── amount: 9900
│   ├── failureCount: 0
│   └── ...
│   }
└── ...

products/{productId}/
├── plan: "plus"/"pro"
├── price: 9900
└── createdAt: "2026-01-12T..."
```

### 로그 확인

브라우저 개발자 도구 콘솔에서 다음 로그들을 확인:

-   `빌링키 발급 성공: ***`
-   `자동 결제 성공: ***`
-   `웹훅 수신: ***`

---

## 🧪 전체 플로우 테스트

### 완전한 구독 플로우

1. **회원가입/로그인** → Firebase 인증
2. **카드 등록** → `/card-registration`
3. **구독 시작** → `/subscription` 또는 `/profile`
4. **첫 결제** → 토스페이먼츠 결제창
5. **웹훅 처리** → 구독 정보 저장
6. **자동 결제** → 매월 스케줄러 실행
7. **상태 관리** → 실패 시 재시도 또는 일시정지

### 각 단계별 확인사항

-   ✅ 카드 등록: `billingKey` 생성 및 저장
-   ✅ 구독 시작: `isRecurring: true` 설정
-   ✅ 첫 결제: `PAYMENT_COMPLETED` 웹훅
-   ✅ 정기 설정: `BILLING_KEY_ISSUED` 웹훅
-   ✅ 자동 결제: `nextBillingDate` 기반 스케줄링
-   ✅ 실패 처리: `failureCount` 증가 및 상태 변경

---

## 🚨 문제 해결

### 자주 발생하는 문제

1. **카드 등록 실패**

    - 테스트 카드 번호 정확히 입력
    - 토스 클라이언트 키 확인

2. **빌링키 발급 실패**

    - 토스 시크릿 키 확인
    - authKey 및 customerKey 유효성 검증

3. **자동 결제 실패**

    - billingKey 존재 여부 확인
    - 구독 상태가 `active`인지 확인

4. **웹훅 미수신**
    - 토스 대시보드에서 웹훅 URL 설정
    - 서명 검증 로직 확인

### 디버깅 팁

```bash
# 사용자 구독 정보 확인 (Firebase Console)
# users/{userId}/subscription

# API 상태 확인
curl "http://localhost:3000/api/billing/scheduled"

# 웹훅 테스트
curl -X POST "http://localhost:3000/api/webhooks/toss" -d '{...}'
```

---

## 🎯 결론

이제 **완전한 토스페이먼츠 월간 구독 시스템**이 준비되었습니다!

✅ **모든 기능 구현 완료**
✅ **단계별 테스트 가능**
✅ **실제 운영 환경 배포 준비**

추가 문의사항이나 커스터마이징이 필요하시면 언제든 말씀해주세요! 🚀
