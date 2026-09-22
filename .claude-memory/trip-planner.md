---
name: trip-planner
description: trip-planner — 링크로 함께 짜는 여행 일정 웹앱 (howardworld Firebase 위)
metadata:
  type: project
---

trip-planner: 링크 하나로 함께 짜는 여행 일정 공유 웹앱. 공용 [[howardworld-firebase-setup]] 위에 올림.

- Hosting: 멀티사이트 `howard-trips` → https://howard-trips.web.app (firebase.json에 "site":"howard-trips"). trip-planner/firebase.json에는 firestore 규칙 미포함(공용 규칙 덮어쓰기 방지).
- 데이터: Firestore `trips/{id}` + `items` 서브컬렉션, onSnapshot 실시간 동기화. 로그인 없이 **URL(/t/{랜덤ID}) = 편집권한**. 규칙은 trips get/write 공개 + list 차단(링크 모르면 접근 불가).
- 지도·검색: **구글맵(Maps JavaScript API) + 구글 Places Text Search(New)**. (원래 OSM/Leaflet+Nominatim이었으나 아시아권 한글 검색이 약해 전환.) 핀 드롭 시 주소 역지오코딩만 무료 Nominatim 유지.
- 구글 API 키: 리퍼러(howard-trips.web.app/*) + Places/Maps JS API로 제한된 **브라우저 키**. gcloud로 생성/관리. 키는 **public/config.js(gitignore)** 에 넣어 주입 — 소스/깃엔 미포함(브라우저엔 어차피 노출되지만 리퍼러 제한이 방어선). app.js는 window.TRIP_CONFIG.googleKey 사용.
- UI: 홈은 월별 달력 뷰(여행을 색 바로 표시). 여행 화면은 Day 탭 + 항목(장소/식사/액티비티/메모) 시간순 자동 정렬. 리스트↔지도 양방향 포커스, 번호 마커 + 경로선 + "전체" 버튼. 항목 "저장 후 계속" 연속 입력. 주소 클릭 시 구글맵 열기.
- 하단 고정 광고 배너: 피그맵/니니구(만든 사람의 다른 앱), 앱스토어 아이콘 + 기기별 스토어/웹 링크.
- 구조: public/app.js 단일 SPA + styles.css + config.js(키). 캐시: firebase.json에 js/css/html no-cache 헤더, 에셋 ?v 버전.
