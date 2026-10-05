---
name: dashboard-plan
description: "4개 서비스 통합 현황판(대시보드) 계획 — 서비스별 데이터 소스 확정, 미착수(사용자 고민 중)"
metadata:
  node_type: memory
  type: project
  originSessionId: f2a2b738-2280-4be0-a63c-ca09b5c4f9ff
  modified: 2026-10-04T09:12:44.149Z
---

4개 서비스(피그맵·니니구·행운일기·하워드 트립)의 현황(전체 사용자/오늘 방문자 등)을 모아보는 현황판 만들기. 2026-10-04 기준 **미착수** — 사용자가 데이터 소스/범위 고민 중이라 보류.

**서비스별 데이터 소스 (확정):**
- 하워드 트립(web): 공유 Firebase `howardworld`의 `events`(고유 기기=사용자, 오늘 고유 기기=방문자) + `trips` → **지금 바로 실데이터 가능**. [[trip-planner]]
- 피그맵: 자체 Firebase 프로젝트. Auth 있음(→전체 가입자 수), GA4 있음(→DAU/WAU/MAU).
- 니니구: 자체 Firebase 프로젝트. Auth 있음, GA4 있음. (피그맵과 동일)
- 행운일기: 자체 Firebase지만 **Auth 없음 + GA4 없음 + 데이터는 기기 로컬 저장만** → 서버에서 끌어올 게 없음. 전체 사용자는 App Store 다운로드 수(수동 입력) 또는 추후 앱에 Analytics 추가해야 가능. 활성 지표는 현재 불가.

**제안한 구조:**
- `functions/`에 Cloud Function 추가: 피그맵·니니구 각 프로젝트 **서비스 계정 키**로 Auth 수+오늘 가입자, **GA4 Data API**로 활성 사용자; `howardworld` events/trips로 트립; 행운일기는 수동값(설정 문서). 결과 10분 캐시.
- 관리자 페이지: 구글 로그인 romeowa@gmail.com 전용. 기본 위치 제안 `howardworld.web.app/admin`(사용자는 위치 선호 없음).
- 보안: 서비스 계정 키는 커밋 금지, gitignore된 `functions/` 아래 서버에서만 사용(기존 VAPID 키와 동일 방식).

**재개 시 사용자에게 받아야 할 것:** 피그맵·니니구 Firebase 프로젝트 ID 2개 + 서비스 계정 키(.json) + 각 GA4 속성에 서비스 계정 뷰어 권한. 착수 순서: 트립(실데이터)+피그맵·니니구 UI 뼈대 먼저, 키 받으면 연결.

**Why:** 여러 번 되묻지 않고 바로 이어가기 위함. 서비스별 가능/불가 지표가 코드로는 안 드러남(앱 코드가 이 저장소에 없음).
**How to apply:** "현황판 다시 하자" 류 요청 시 이 메모의 소스 맵대로 설계부터 재개. 행운일기는 서버 데이터 없음을 전제로.
