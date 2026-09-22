---
name: howardworld-firebase-setup
description: HowardWorld 레포의 공용 Firebase(howardworld) 인프라 구성
metadata:
  type: project
---

HowardWorld는 잡다한 개인 프로젝트 모음 레포. 서버는 Firebase 프로젝트 `howardworld` (project number 940701312592)를 공유. 프로젝트별 상세는 별도 memory 파일 참고: [[trip-planner]].

## 공용 인프라
- Firestore: `(default)` DB, asia-northeast3 (서울). 여러 앱이 이 하나의 Firestore를 공유.
- **보안 규칙은 레포 루트 `firestore/firestore.rules` 단일 파일에서만 관리** → `cd firestore && firebase deploy --only firestore:rules`. (앱별 firebase.json에는 firestore 규칙 설정 미포함 — 덮어쓰기 방지.)
- 결제: 2026-09 기준 **Blaze(결제) 활성** (billing account 012FC2-…). 구글맵/Places/Routes 유료 API 사용 가능하나 개인 사용량이라 실비용 ≈ 0. 예산 알림 설정됨(월 ₩1만, 50/90/100% 이메일).
- 사용 로그: 공용 `events` 컬렉션. 요약 CLI `node tools/usage-report.js [일수]`(gcloud 로그인 토큰+REST, 서비스계정 불필요). 웹 대시보드는 trip-planner `/admin`.
- Hosting 사이트 2개: `howardworld`(랜딩, howardworld.web.app, 소스 `howardworld-web/`) + `howard-trips`(trip-planner).

## 제거된 것
- **flight-watch**: 항공권 감시(구글플라이트 크롤링 + launchd 데몬 + 메뉴바 앱 + FCM). 2026-09-23 사용 중단·제거. launchd 데몬/plist/메뉴바앱 삭제, Firestore 데이터(watches·history·fcmTokens·notifications·control) 삭제, 레포 flight-watch/ 폴더 삭제. 규칙은 firestore/로 이전. (firebase-adminsdk SA는 남아 있음 — 무해)

## 기타 계정 내 프로젝트
- `halfred-fa78c`: halfred 생성 command 백업용으로 별도 생성 (이 레포와 별개, 2026-09 시점 미착수).
