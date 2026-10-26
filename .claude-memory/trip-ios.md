---
name: trip-ios
description: trip-planner의 네이티브 iOS 앱(SwiftUI) — 기존 Firestore 여행 데이터 공유
metadata:
  node_type: memory
  type: project
  originSessionId: f2a2b738-2280-4be0-a63c-ca09b5c4f9ff
  modified: 2026-10-25T15:04:41.102Z
---

trip-ios: 하워드 트립(trip-planner)의 **네이티브 SwiftUI iOS 앱**. 사용자가 "네이티브 전면 재작성" 선택(2026-10). 레포 `trip-ios/`. 웹 [[trip-planner]]과 **같은 Firestore(howardworld)** 공유.

- 빌드: **xcodegen**(`project.yml`) → `HowardTrip.xcodeproj`(gitignore, `xcodegen generate`로 재생성). iOS 17+, 번들 `com.howard.howardtrip`, 앱명 "하워드 트립". 시뮬레이터 빌드는 `CODE_SIGNING_ALLOWED=NO`.
  - 빌드 명령: `cd trip-ios && xcodebuild -project HowardTrip.xcodeproj -scheme HowardTrip -sdk iphonesimulator -configuration Debug -destination 'generic/platform=iOS Simulator' -derivedDataPath build build` (특정 기기 이름 destination은 매칭 실패 → generic 사용).
- 데이터: **Firestore REST로 키·로그인 없이** 공개 규칙 문서(trips/items) 읽기+쓰기. `https://firestore.googleapis.com/v1/projects/howardworld/databases/(default)/documents/...` (웹 share 함수와 동일, 비브라우저 GET/POST/PATCH/DELETE 모두 HTTP 200 확인). 쓰기: addItem(POST), updateItem(PATCH+updateMask.fieldPaths), setDay(날짜만 PATCH), deleteItem(DELETE), createTrip(POST /trips → title/startDate/dayCount/createdAt). order=클라ms. createdAt는 클라 ISO를 timestampValue로 직접 기록(serverTimestamp transform 불필요, 웹과 동일 스키마).
- 구조(Sources/): App(@main)·Models(Trip/Item/ItemType/RecentTrip)·FirestoreREST(값 파서+getTrip/getItems)·Store(ObservableObject, 최근여행 UserDefaults, 링크→id 추출)·HomeView(링크/ID 열기+최근, 우상단 + 새 여행)·NewTripSheet(제목·시작일 토글·기간 스테퍼 → createTrip 후 remember+이동)·TripView(일자 섹션 타임라인 + 후보 섹션 + MapKit `Map` 번호 마커).
- 지도: **MapKit**(네이티브, 키 불필요). 검색은 **MKLocalSearch**(PlaceSearch.swift, 한국 영역 바이어스) — ItemEditor '장소 검색' 섹션에서 결과 선택 시 이름·주소·좌표 채우고 미니맵 표시, 저장 시 lat/lng 반영돼 일정 지도에 핀. 영문 지명도 한국 결과 반환(예 Gyeongbokgung Palace). TripMap: 방문 순서 **번호 핀**(Annotation+NumberPin, teal 원+흰 번호+아래 꼬리, anchor=.bottom) + 순서대로 잇는 **경로선 MapPolyline**(teal), 경로선은 **날짜별로 끊어서** 그림(같은 날끼리만).
- **1단계 완료(2026-10)**: 실제 '추석' 여행 읽어 타임라인+지도 렌더 확인. **2단계(쓰기) 완료**: 항목 추가/수정/삭제·후보 편입/내리기 시뮬레이터 확인(ItemEditor 시트, TripView 스와이프/메뉴). **3단계(장소 검색) 완료**(MKLocalSearch). **4단계(새 여행 생성) 완료**(NewTripSheet→createTrip, 시뮬레이터에서 제목·시작일·기간 입력→생성→TripView 자동 이동, Firestore 필드 확인 후 테스트 여행 삭제). **5단계(실시간 동기화=폴링) 완료**: 사용자가 SDK 대신 폴링 선택. TripView가 `.task`에서 4초 간격 getTrip+getItems 재조회(syncSilently, Equatable 비교로 변경분만 반영해 깜빡임 방지), 편집 시트(editTarget) 떠 있으면 건너뜀, scenePhase .active 복귀 시 즉시 1회, `.refreshable` 당겨서 새로고침, 백그라운드 동기화 중 toolbar ProgressView. 일시 오류·404(삭제됨)는 조용히 무시(화면 안 지움). 외부 REST로 추가/삭제/제목변경이 ~4초 내 자동 반영됨 확인. **7단계(앱 아이콘) 완료**: teal 그라데이션 + 흰 지도 핀(가운데 구멍으로 그라데이션 비침) + 좌하단 경로 점선. (한때 '번호 핀 3개 순서형'으로 바꿨다가 사용자 요청으로 단일 핀으로 되돌림 — 순서 표시는 아이콘이 아니라 '지도 핀'에 적용함, 아래 참고.) 재현 스크립트 `trip-ios/tools/make_icon.py`(Pillow 4배 슈퍼샘플링→1024 PNG, 알파 제거). `Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png` 단일 1024 유니버설, 빌드 경고 없음·번들에 AppIcon 렌디션 확인. **6단계(정산 탭) 완료**: 웹 정산 전체 이식. TripView 상단 세그먼트(일정/정산), SettleView(참여자 추가/삭제, 요약+카테고리바, 공금 카드, 환율 편집, 송금 제안, 정산표, 지출/수입 내역), ExpenseEditor(지출/수입 탭·Day 카드·통화·구분·결제자/공금·나눠낼사람·기록자), SettleHistoryView(settleLog). `Settlement.swift`에 computeSettlement 그대로 이식(개인/공금/수입·외화환산·송금 최소화), Expense 모델·Trip 확장(memberColors/rates/expenseCategories). expenses도 폴링에 포함. settleLog는 규칙상 read·create만 가능(수정·삭제 불가)→클라 ts로 append. 시뮬레이터에서 혼합 데이터로 계산·UI·쓰기·이력 전부 검증(수기 계산과 일치). 다음 단계 후보: 푸시(APNs), 앱 아이콘, 앱스토어 준비(서명·GoogleService-Info는 Firebase SDK 전환 시).
- **정산 데이터 스키마**(expenses 서브컬렉션): kind(expense|income), amount(원금), currency(KRW/JPY/USD), desc, category, offTrip, day, date, place, payer(공금/수입이면 ""), fromPool, sharedBy[], contribs{이름:원금}(수입), order. 통화 환산은 trip.rates[cur] 우선 없으면 기본(JPY9/USD1350). 공금 쓰이면 모두 공금과만 정산, 아니면 개인끼리 그리디 송금.
- **시뮬레이터 여행 열기 우회**: 홈 링크/ID 입력칸은 `.keyboardType(.URL)`라 ASCII가 안 깨짐 → control `text`로 trip id 직접 입력해 여는 게 가장 확실(최근목록 plist 심기는 cfprefsd 캐시가 덮어써서 불안정).
- **시뮬레이터 텍스트 입력 결론**: control `text`가 비ASCII(한글)를 깨뜨림(IME/클립보드 인코딩). 쓰기 검증은 가능하나 입력 내용이 깨져도 로직 확인엔 지장 없음. 실제 사용자 입력은 정상.
- **주의(시뮬레이터 텍스트 입력)**: 한글 IME가 활성이면 control `text` 주입이 ASCII를 한글로 변형함(키보드를 QWERTY로 바꿔도 마찬가지). ID/링크 입력 검증은 클립보드 붙여넣기나 임시 버튼으로 우회.
