---
name: howardworld-firebase-setup
description: HowardWorld 레포의 공용 Firebase(howardworld) 구성과 flight-watch 프로젝트 컨텍스트
metadata:
  type: project
---

HowardWorld는 잡다한 개인 프로젝트 모음 레포. 서버는 Firebase 프로젝트 `howardworld` (project number 940701312592)를 공유. 프로젝트별 상세는 별도 memory 파일 참고: [[trip-planner]].

## 공용 인프라
- Firestore: `(default)` DB, asia-northeast3 (서울). 여러 프로젝트가 이 하나의 Firestore를 공유.
- **보안 규칙은 flight-watch/firestore.rules 단일 파일에서만 관리** → `cd flight-watch && firebase deploy --only firestore:rules`. 다른 프로젝트 firebase.json에는 firestore 규칙 설정을 넣지 않아 덮어쓰기 방지.
- 결제: 2026-09 기준 **Blaze(결제) 활성** (billing account "Firebase Payment" 012FC2-…). 그래서 구글맵/Places 같은 유료 API 사용 가능. 다만 개인 사용량이라 실비용은 거의 0.

## flight-watch (첫 프로젝트)
- 목적: 항공권 조건(직항/가격 등) 감시 → 조건 충족 시 Mac/iPhone 알림.
- 데이터 소스: Amadeus가 2026-07-17 Self-Service API 종료해서 **Mac에서 구글플라이트 크롤링**으로 전환. 크롤러는 `hl=en` aria-label 파싱 + 직항 감시는 nonstop 필터 사용 — 구글 DOM 변경 시 crawler/googleFlights.js 수리 필요.
- 실행: Mac launchd 상주 데몬 `com.howard.flight-watch`, Playwright, **1시간 간격**. 로그 ~/Library/Logs/flight-watch.log (5MB 자가 로테이션).
- 알림: 데몬이 Firestore `notifications` 컬렉션에 기록 → ① 맥앱이 15초 폴링해 UNUserNotificationCenter 네이티브 알림, ② iPhone은 FCM 웹 푸시(PWA, VAPID 적용됨).
- 메뉴바 앱: flight-watch/macapp (SwiftUI 단일 파일, build.sh로 swiftc 빌드 → ~/Applications/FlightWatch.app). Firestore REST 공개 읽기로 상태 표시, launchctl로 데몬 제어. 감시 추가/수정/삭제, 가격 그래프.
- Admin SDK 키: flight-watch/crawler/serviceAccount.json (gitignore, firebase-adminsdk-fbsvc SA).
- Hosting(웹 UI): https://howardworld.web.app (기본 사이트).

## 기타 계정 내 프로젝트
- `halfred-fa78c`: halfred 생성 command 백업용으로 별도 생성 (이 레포와 별개, 2026-09 시점 미착수).
