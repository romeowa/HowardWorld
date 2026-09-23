---
name: trip-planner
description: trip-planner — 링크로 함께 짜는 여행 일정 웹앱 (howardworld Firebase 위)
metadata: 
  node_type: memory
  type: project
  originSessionId: f2a2b738-2280-4be0-a63c-ca09b5c4f9ff
  modified: 2026-09-23T00:00:00.000Z
---

trip-planner: 링크 하나로 함께 짜는 여행 일정 공유 웹앱. 공용 [[howardworld-firebase-setup]] 위에 올림.

- Hosting: 멀티사이트 `howard-trips` → https://howard-trips.web.app (firebase.json에 "site":"howard-trips"). trip-planner/firebase.json에는 firestore 규칙 미포함(공용 규칙 덮어쓰기 방지).
- 데이터: Firestore `trips/{id}` + `items` 서브컬렉션, onSnapshot 실시간 동기화. 로그인 없이 **URL(/t/{랜덤ID}) = 편집권한**. 규칙은 trips get/write 공개 + list 차단(링크 모르면 접근 불가).
- 지도·검색: **구글맵(Maps JavaScript API) + 구글 Places Text Search(New)**. (원래 OSM/Leaflet+Nominatim이었으나 아시아권 한글 검색이 약해 전환.) 핀 드롭 시 주소 역지오코딩만 무료 Nominatim 유지.
- 구글 API 키: 리퍼러(howard-trips.web.app/*) + Places/Maps JS API로 제한된 **브라우저 키**. gcloud로 생성/관리. 키는 **public/config.js(gitignore)** 에 넣어 주입 — 소스/깃엔 미포함(브라우저엔 어차피 노출되지만 리퍼러 제한이 방어선). app.js는 window.TRIP_CONFIG.googleKey 사용.
- UI: 홈은 월별 달력 뷰(여행을 색 바로 표시) + 이 기기 localStorage 최근 목록만. 여행 화면은 전체 일정 리스트(Day별 섹션) + 상단 '전체'/날짜 탭(전체=다 보기, 날짜=그 날만 필터). 항목(장소/식사/액티비티/메모) 시간순 자동 정렬, 시간 입력은 24시간 시/분 드롭다운. 항목 클릭 시 아래로 확장되며 인라인 미니지도(핀 1개). 항목 "저장 후 계속" 연속 입력. 주소 클릭 시 구글맵 열기.
- 광고: 피그맵/니니구(만든 사람의 다른 앱), 리스트 맨 끝에 붙임(화면 하단 고정 아님).
- 디자인: Claude Design 시안 기반 웜 라이트 타임라인(1a) + 월별 달력 홈(2a). IBM Plex Sans KR + JetBrains Mono. 여행 화면은 넓으면 타임라인|지도 2단, 좁으면 세로 1단(반응형).
- 오프라인(PWA): sw.js(앱 셸 stale-while-revalidate, 전체 URL로 캐시) + Firestore persistentLocalCache. 오프라인 배너. SW 버전 올릴 때 sw.js의 VERSION 상수 갱신.
- 시도했다 뺀 것: 장소 간 이동시간(구글 Routes API) — 국내는 지도반출 규제로 자동차/도보 경로 안 나오고 대중교통만, 품질 별로라 제거. 비용/예산 기능도 제거. (Routes API는 키에 활성화돼 있음)
- 사용 로그: 공용 Firestore `events` 컬렉션(공개 create). trip-planner가 trip_open/create·item_add/delete·trip_delete 기록, flight-watch 크롤러가 check_run 기록.
- 관리자 페이지 `/admin`: 구글 로그인(romeowa@gmail.com만) 후 events 대시보드(앱별·유형별·날짜별·최근). 규칙: events read는 `request.auth.token.email == 'romeowa@gmail.com'`만. **주의**: Firestore SDK가 인증 토큰을 요청에 안 붙이는 문제로 SDK 쿼리는 permission-denied → admin 조회는 `auth.currentUser.getIdToken()`을 Authorization 헤더에 실어 **REST runQuery로 직접 호출**함. Auth는 firebase-auth 정적 import + 시작 시 getAuth(app). 구글 로그인 provider + howard-trips.web.app 승인 도메인은 콘솔에서 활성화 완료.
- CLI 요약도 가능: `node tools/usage-report.js [일수]`(서비스 계정). 비용 예산 알림은 콘솔에서 설정 완료(월 ₩1만, 50/90/100% 이메일).
- events 필드: type·app·dev(기기ID)·os·br·form·country·city, 그리고 유형별 부가(trip, promo, check_run의 watches/notified/errors). 위치는 ipwho.is IP기반(세션1회, 권한팝업 없음). admin은 기기(dev)별로 묶어 표시.
- 정산 기능: 여행 상단 '💰 정산' 버튼 → 정산 창(.settle-bg 오버레이). 참여자(trip.members) 칩 추가/삭제, 정산 내역(trips/{id}/expenses 서브컬렉션: date·category·desc·amount·payer·sharedBy[], 실시간 onSnapshot) 입력·수정·삭제, 1인 비용 자동. 정산표(개인별 비용/결제/net) + 최소 송금 제안(그리디) + 카테고리별 합계. 구분(trip.expenseCategories)은 기본 6종(숙박/식사/교통/간식/관광/기타 = DEFAULT_CATS) + '새 구분 추가'. 규칙: expenses read/write 공개(items와 동일, 링크=편집권한). 창 열려 있을 때만 expenses 구독(unsubExpenses)·settleRerender로 재렌더.
- 뺀 UI(2026-09): "홈 화면에 추가"(PWA 설치) 버튼, 홈의 "☁︎ 내 여행"(관리자 구글 로그인 시 Firestore 전체 trips 로드) 기능 모두 제거. 홈은 다시 이 기기 localStorage 최근 목록만. (trips list 규칙은 /admin용으로 유지, app.js의 auth import·getAuth·onAuthStateChanged는 /admin 전용으로 남김.)
- 구조: public/app.js 단일 SPA + styles.css + config.js(키) + sw.js. 캐시: firebase.json에 js/css/html no-cache 헤더, 에셋 ?v 버전.
