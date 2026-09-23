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
- 날씨: 일정 항목에 핀(lat/lng)+날짜(startDate+day)가 있으면 **Open-Meteo 예보**(api.open-meteo.com/v1/forecast, 무료·키 불필요)로 아이콘+최고/최저 기온 칩(.tl-weather) 표시. getWeather(date,lat,lng)가 좌표 소수2자리+날짜로 캐시. 예보 범위(약 -92~+16일) 밖이면 표시 안 함.
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
- 정산 기능(Claude Design 시안 3a/3b 반영): 여행 화면 상단 **'일정 | 정산' 탭**(tripTab, 모달 아님). renderTrip에서 expenses 항상 구독(unsubExpenses), paint()가 tripTab==="settle"이면 renderSettleView(shell) 렌더 후 return.
  - 참여자(trip.members)를 **색상 아바타 칩**으로(memberColor 팔레트, initOf). 추가/삭제.
  - 요약: 총 지출 + 1인 평균 + 카테고리 색상 바/범례(catColor). 정산표(.stl-tally: 이름·쓴 돈·낸 돈·차액) + '이렇게 보내면 끝' 송금 제안(그리디, 아바타). 데스크톱 2단(.stl-body: 내역 | 요약 side), 모바일 1단(side order:-1, 정산표 숨김) 반응형.
  - 내역: **일자별(expDay=day 또는 date)로 묶어** 카드로 표시. 카드의 참여자 아바타(.exp-av) 클릭 시 sharedBy 즉시 토글(updateDoc). 카드 클릭 → 지출 수정.
  - 지출 추가/수정(openExpenseForm, 3b v2): 순서 = **언제·어디서(날짜 가로스크롤 카드 + 장소 칩) → 금액(크게) → 구분 칩(+새 구분) → 내역 → 결제자 아바타 → 나눠 낼 사람 아바타**. 날짜 카드에 '여행 외' 옵션(offTrip) → 결제일(date) 직접 입력.
  - 데스크톱 빠른 추가(buildInlineAdd, 3a desktop v2, .stl-quickadd, 모바일 숨김): 한 카드에 날짜/장소/구분/결제자 select + 나눠 낼 사람 토글 + 실시간 1인. 새 참여자는 known 추적으로 자동 나눔 포함.
  - 데이터: trips/{id}/expenses = date·**day**(정수, 여행 외는 null)·**offTrip**(bool)·category·desc·amount·payer·sharedBy[]·**place**. 그룹핑 expDay(): day 정수→그날, offTrip/범위밖→"여행 외". 규칙: expenses read/write 공개(items와 동일). 구분 기본 6종 DEFAULT_CATS(숙박/식사/교통/간식/관광/기타).
  - 시안 원본: claude.ai/design 프로젝트 c4cd9018-f180-41fb-9d75-25e44224f54c, 파일 '여행일정 개선안.dc.html'(3a=정산 탭, 3b=지출 추가, 1a=일정 기준 스타일). DesignSync MCP(get_file)로 읽음.
- 뺀 UI(2026-09): "홈 화면에 추가"(PWA 설치) 버튼, 홈의 "☁︎ 내 여행"(관리자 구글 로그인 시 Firestore 전체 trips 로드) 기능 모두 제거. 홈은 다시 이 기기 localStorage 최근 목록만. (trips list 규칙은 /admin용으로 유지, app.js의 auth import·getAuth·onAuthStateChanged는 /admin 전용으로 남김.)
- Export/Import(JSON): 여행 화면 하단 '이 여행 내보내기'(다운로드) / '파일로 덮어쓰기'(overwriteTripFromBundle, 확인 후 items·expenses 삭제 후 재생성). 홈 헤더 '내보내기'(exportAllTrips: localStorage 최근목록 전부 → 한 파일) / '가져오기'(importTripsFromHome → createTripFromBundle로 새 여행 추가, 단일·번들 모두 지원). 번들 포맷: {app:"trip-planner", kind:"trip"|"trips", version, trip{title,startDate,dayCount,members,memberColors,expenseCategories}, items[], expenses[]} (kind trips는 trips:[{trip,items,expenses}]). createdAt 등 서버 필드는 stripId로 제외하고 가져올 때 serverTimestamp 재생성.
- 참여자 색: 추가 시 addMember()가 기존 참여자와 안 겹치는 팔레트 색을 랜덤 배정해 trip.memberColors 맵에 저장. memberColor(name)=저장색 우선, 없으면 이름 해시 폴백.
- 구조: public/app.js 단일 SPA + styles.css + config.js(키) + sw.js. 캐시: firebase.json에 js/css/html no-cache 헤더, 에셋 ?v 버전.
