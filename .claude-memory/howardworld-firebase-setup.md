---
name: howardworld-firebase-setup
description: HowardWorld 레포의 Firebase 프로젝트 구성과 첫 프로젝트(flight-watch) 컨텍스트
metadata: 
  node_type: memory
  type: project
  originSessionId: f2a2b738-2280-4be0-a63c-ca09b5c4f9ff
---

HowardWorld는 잡다한 개인 프로젝트 모음 레포. 서버 사이드는 Firebase 프로젝트 `howardworld` (project number 940701312592)를 공유.

- Firestore: `(default)` DB, asia-northeast3 (서울)
- 웹 앱: "flight-watch" (appId 1:940701312592:web:8882de89e067b9a727d355), Hosting: https://howardworld.web.app
- Spark(무료) 플랜으로 충분 — Functions 안 씀 (Amadeus가 2026-07-17 Self-Service API 종료 + 신규가입 중단이라 Mac 크롤링으로 전환)
- 첫 프로젝트 flight-watch: Mac launchd 상주 데몬(`com.howard.flight-watch`)이 Playwright로 구글플라이트 크롤링(30분 간격), 조건 매칭 후 FCM 웹 푸시. 크롤러는 hl=en aria-label 파싱 방식 — 구글 DOM 변경 시 crawler/googleFlights.js 수리 필요
- Admin SDK 키: flight-watch/crawler/serviceAccount.json (gitignore됨, firebase-adminsdk-fbsvc SA)
- 메뉴바 앱: flight-watch/macapp (SwiftUI 단일 파일, build.sh로 swiftc 빌드, ~/Applications/FlightWatch.app 설치됨). Firestore REST 공개 읽기로 상태 표시, launchctl로 데몬 제어 — control/notifications 컬렉션 규칙(공개 read)에 의존하므로 규칙 잠글 때 같이 수정 필요
- 알림 경로: Mac은 데몬이 notifications 컬렉션에 기록 → 맥앱이 15초 폴링으로 감지해 UNUserNotificationCenter 네이티브 알림. iPhone은 FCM 웹 푸시(PWA, VAPID 키 적용됨) 그대로
- 남은 수동 단계: VAPID 키 생성(콘솔→클라우드 메시징→웹 푸시 인증서) 후 public/app.js의 VAPID_KEY에 삽입 + hosting 재배포 — 상세는 flight-watch/README.md
