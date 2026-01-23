# TossPayments 웹훅 설정 가이드

## 1. 웹훅이란?

웹훅(Webhook)은 결제 상태가 변경될 때 토스페이먼츠 서버에서 여러분의 서버로 실시간 알림을 보내는 기능입니다.

## 2. 웹훅 URL

프로덕션 환경:

```
https://yourdomain.com/api/webhooks/toss
```

> ⚠️ `yourdomain.com`을 실제 도메인으로 변경하세요.

## 3. 지원하는 이벤트 타입

| 이벤트 타입              | 설명                                                                |
| ------------------------ | ------------------------------------------------------------------- |
| `PAYMENT_STATUS_CHANGED` | 결제 상태 변경 (DONE, CANCELED, PARTIAL_CANCELED, ABORTED, EXPIRED) |
| `CANCEL_STATUS_CHANGED`  | 결제 취소 상태 (비동기 취소 결과)                                   |
| `BILLING_DELETED`        | 빌링키 삭제                                                         |
| `DEPOSIT_CALLBACK`       | 가상계좌 입금/입금취소                                              |

## 4. 웹훅 등록 방법

### 4.1. 토스페이먼츠 개발자센터 접속

1. [토스페이먼츠 개발자센터](https://developers.tosspayments.com) 접속
2. 로그인 후 대시보드로 이동

### 4.2. 웹훅 등록

1. 좌측 메뉴에서 **웹훅** 클릭
2. **웹훅 등록하기** 버튼 클릭
3. 다음 정보 입력:
    - **웹훅 이름**: `Nova AI 결제 웹훅`
    - **웹훅 URL**: `https://yourdomain.com/api/webhooks/toss`
    - **이벤트 선택**:
        - ✅ PAYMENT_STATUS_CHANGED
        - ✅ CANCEL_STATUS_CHANGED
        - ✅ BILLING_DELETED
        - ✅ DEPOSIT_CALLBACK (가상계좌 사용 시)
4. **등록하기** 클릭

## 5. 로컬 개발 환경 테스트

로컬 환경에서는 ngrok을 사용하여 테스트할 수 있습니다.

### 5.1. ngrok 설치 및 실행

```bash
# ngrok 설치 (macOS)
brew install ngrok

# 로컬 서버 포트 포워딩 (Next.js 기본 포트 3000)
ngrok http 3000
```

### 5.2. ngrok URL 등록

ngrok 실행 후 표시되는 `Forwarding` URL을 웹훅 URL로 등록:

```
https://abc123.ngrok.io/api/webhooks/toss
```

> ⚠️ 무료 ngrok은 URL이 재실행 시 변경됩니다.

## 6. 웹훅 응답 정책

- **10초 이내**에 `200` 응답을 반환해야 합니다.
- 응답하지 않으면 토스페이먼츠가 최대 **7회** 재전송합니다.

### 재전송 간격

| 재전송 횟수 | 간격 (분) |
| ----------- | --------- |
| 1           | 1         |
| 2           | 4         |
| 3           | 16        |
| 4           | 64        |
| 5           | 256       |
| 6           | 1024      |
| 7           | 4096      |

## 7. 웹훅 로그 확인

모든 웹훅 이벤트는 Firebase Firestore의 `webhookLogs` 컬렉션에 저장됩니다.

```
webhookLogs/
├── {documentId}
│   ├── eventType: "PAYMENT_STATUS_CHANGED"
│   ├── body: { ... }
│   ├── receivedAt: "2026-01-23T12:00:00.000Z"
│   ├── processed: true
│   └── processedAt: "2026-01-23T12:00:01.000Z"
```

## 8. 환경 변수

웹훅 핸들러가 정상 작동하려면 다음 환경 변수가 필요합니다:

```env
# Firebase Admin SDK 인증 정보 (JSON 문자열)
FIREBASE_ADMIN_CREDENTIALS={"type":"service_account",...}

# TossPayments 시크릿 키 (결제 검증용)
TOSS_SECRET_KEY=test_sk_xxx...
```

## 9. 문제 해결

### 웹훅이 도착하지 않는 경우

1. **URL 확인**: 웹훅 URL이 외부에서 접근 가능한지 확인
2. **방화벽**: 포트 방화벽 설정 확인
3. **HTTPS**: 프로덕션에서는 HTTPS 필수
4. **전송 기록**: 개발자센터에서 웹훅 전송 기록 확인

### 웹훅 처리 실패

1. Firebase Console에서 `webhookLogs` 컬렉션 확인
2. Vercel/서버 로그에서 에러 메시지 확인
3. `FIREBASE_ADMIN_CREDENTIALS` 환경 변수 확인

## 10. 참고 문서

- [토스페이먼츠 웹훅 가이드](https://docs.tosspayments.com/guides/webhook)
- [토스페이먼츠 개발자센터](https://developers.tosspayments.com)
