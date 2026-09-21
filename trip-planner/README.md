# 🧳 trip-planner

링크 하나로 함께 짜는 여행 일정 웹 서비스. 로그인 없이 URL만 알면 누구나 보고/수정할 수 있다.

- **웹**: https://howard-trips.web.app
- **백엔드**: Firestore (howardworld 프로젝트 공유) — 실시간 동기화, 서버 코드 없음(클라이언트가 직접 읽기/쓰기)
- **지도**: OpenStreetMap(Leaflet) — 표시·핀
- **장소 검색**: 구글 Places API (Text Search, New) — 한글로 해외 POI 검색. 웹 키는 howard-trips.web.app 리퍼러 + Places API로 제한
- **핀→주소 역지오코딩**: Nominatim(무료) — 지도 클릭/드래그 시

## 동작 방식

1. 홈에서 "새 여행 만들기" → `trips/{임의ID}` 문서 생성 → `/t/{id}`로 이동
2. 그 링크(`/t/{id}`)를 아는 사람은 누구나 접속해 같이 편집 — 링크의 랜덤 ID가 사실상 비밀번호
3. 여러 명이 동시에 편집하면 Firestore `onSnapshot`으로 즉시 반영
4. 각 항목(장소/식사/액티비티/메모)에 지도 검색으로 위치를 붙이고, "이 날 지도"로 핀 모아보기

## 데이터 모델 (Firestore)

```
trips/{tripId}              # { title, startDate, dayCount, createdAt }
trips/{tripId}/items/{id}   # { day, type(place|food|activity|note), name, address,
                            #   lat, lng, time, memo, order, createdAt }
```

- **보안 규칙**: `trips`는 `get`/`write`만 공개, `list`는 차단(전체 목록 조회 불가 → 링크 모르면 접근 불가).
  규칙은 howardworld 전체가 공유하는 단일 파일 [`../flight-watch/firestore.rules`](../flight-watch/firestore.rules)에서 관리한다.

## 배포

```bash
# 웹만 (이 사이트: howard-trips)
firebase deploy --only hosting --project howardworld

# 보안 규칙 (⚠️ flight-watch 디렉토리에서 — howardworld Firestore 규칙 단일 관리)
cd ../flight-watch && firebase deploy --only firestore:rules --project howardworld
```

> trip-planner의 `firebase.json`에는 firestore 규칙 설정을 일부러 넣지 않았다.
> 여기서 배포해도 규칙을 건드리지 않아 flight-watch 규칙을 덮어쓸 위험이 없다.

## 구조

```
public/
  index.html      # 셸 (Leaflet + Firebase SDK 로드)
  app.js          # SPA 전체 — 라우팅/실시간/지도/항목편집 (한 파일)
  styles.css      # 라이트+다크(prefers-color-scheme) 대응
  manifest.json   # 홈 화면 추가용 PWA
```

## 나중에 할 것

- [ ] 항목 드래그 정렬 (지금은 시간순 자동 정렬)
- [ ] Firebase Auth로 "편집 잠금" 옵션 (지금은 링크=편집권한)
- [ ] 구글맵 전환 옵션 (Places 상세정보/평점 — 결제 계정 필요)
- [ ] 지출/예산 트래킹
