# HowardWorld

잡다한 개인 프로젝트 모음. 서버 사이드는 Firebase 프로젝트 `howardworld`를 공유해서 사용.

| 프로젝트 | 설명 |
|---|---|
| [trip-planner](trip-planner/) | 링크로 함께 짜는 여행 일정 공유 (Firestore 실시간 + 구글맵/Places, 월별 달력 홈, 오프라인 PWA) |

## 공유 인프라

| 위치 | 용도 |
|---|---|
| [firestore/](firestore/) | 공유 Firestore 보안 규칙. 배포: `cd firestore && firebase deploy --only firestore:rules` |
| [howardworld-web/](howardworld-web/) | howardworld.web.app 랜딩 페이지 |
| [tools/usage-report.js](tools/usage-report.js) | 사용 로그(events) 요약 — `node tools/usage-report.js [일수]` (gcloud 로그인 필요) |

활동 로그 대시보드는 https://howard-trips.web.app/admin (romeowa@gmail.com 로그인).
