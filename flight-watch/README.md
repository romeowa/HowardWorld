# ✈️ flight-watch

출발일/귀국일과 조건(최대 가격, 경유 횟수, 출발 시간대)을 등록해두면 Mac에서 30분마다 구글플라이트를 크롤링하고, 조건에 맞는 항공권이 나오면 Mac/iPhone에 FCM 웹 푸시를 보내는 프로젝트.

- **웹 UI**: https://howardworld.web.app — 감시 추가/관리, 알림 기기 등록, 수동 체크
- **크롤러 데몬**: Mac launchd 상주 프로세스 (`crawler/`) — Playwright로 구글플라이트 크롤링
- **데이터**: Firestore — `watches`(감시 조건), `watches/{id}/history`(가격 추이), `fcmTokens`(푸시 기기), `control`(데몬 제어/상태)

> 원래 Amadeus Self-Service API로 만들었으나, Amadeus가 2026-07-17부로 Self-Service를 종료(신규 가입은 이미 중단)해서 Mac 크롤링 방식으로 전환. 덕분에 Blaze 플랜 불필요 — 전부 무료 티어로 동작.

## 동작 방식

1. launchd가 `crawler/index.js` 데몬을 항상 띄워둠 (로그인 시 자동 시작, 죽으면 재시작)
2. 데몬은 시작 시 + 30분마다 + 웹 UI "지금 체크" 클릭 시(`control/checkNow` 감지) 전체 감시 검사
3. 감시마다 구글플라이트 검색(`hl=en&curr=KRW`) → aria-label 파싱 → 가격/경유/시간대 조건 필터링
   - 귀국편 시간 조건이 있으면 가는편 상위 5개를 클릭해 귀국편 조합까지 파싱
4. 조건 충족 항공권이 **처음 나타나거나 이전 알림보다 가격이 떨어지면** 모든 등록 기기에 푸시
5. 출발일이 지난 감시는 자동 비활성화. 검사 결과는 `history`에 쌓여 가격 추이 확인 가능

## 남은 설정 (1개)

### 웹 푸시 VAPID 키
Firebase 콘솔 → 프로젝트 설정 → 클라우드 메시징 → **웹 푸시 인증서** → 키 쌍 생성
→ `public/app.js`의 `VAPID_KEY`에 붙여넣기 → `firebase deploy --only hosting`

### 기기 등록
- **Mac**: https://howardworld.web.app → "🔔 이 기기에서 알림 받기"
- **iPhone**: Safari 접속 → 공유 → **홈 화면에 추가** → 홈 화면 앱에서 "🔔 이 기기에서 알림 받기" (iOS 16.4+)

## 운영 명령

```bash
# 데몬 상태/재시작/중지
launchctl list | grep flight-watch
launchctl kickstart -k gui/$(id -u)/com.howard.flight-watch   # 재시작
launchctl bootout gui/$(id -u)/com.howard.flight-watch        # 중지

# 로그
tail -f ~/Library/Logs/flight-watch.log

# 크롤러 단독 테스트 (Firestore 안 건드림)
cd crawler
node testCrawl.js ICN FUK 2026-07-10                  # 편도
node testCrawl.js ICN FUK 2026-07-10 2026-07-14       # 왕복
node testCrawl.js ICN FUK 2026-07-10 2026-07-14 --inbound --headed  # 귀국편 파싱, 브라우저 표시

# 1회 검사 (데몬 안 거치고)
node index.js --once

# 웹 UI 배포
firebase deploy --only hosting
```

## 구조

```
crawler/
  index.js           # 상주 데몬: 주기 검사 + control/checkNow 감지 + 알림 판단
  googleFlights.js   # Playwright 구글플라이트 크롤링/파싱
  matcher.js         # 조건 매칭 (가격/경유/시간대)
  notify.js          # fcmTokens 전체에 푸시 + 죽은 토큰 정리
  testCrawl.js       # 크롤러 단독 테스트 CLI
  serviceAccount.json          # Admin SDK 키 (gitignore됨)
  com.howard.flight-watch.plist # launchd 설정 (~/Library/LaunchAgents에 복사본 설치됨)
public/
  index.html / app.js          # 감시 관리 UI (Firestore 직접 읽기/쓰기)
  firebase-messaging-sw.js     # 백그라운드 푸시 서비스워커
  manifest.json                # iOS 홈 화면 추가용 PWA 매니페스트
```

## 주의사항

- **Mac이 켜져 있어야** 체크가 돈다 (잠자기 중엔 멈춤; 깨어나면 재개)
- 구글플라이트 DOM이 바뀌면 `googleFlights.js` 파서 수리 필요. 파싱 실패 시 `/tmp/flight-watch-error.png`에 스크린샷 저장됨
- 크롤링 간격을 너무 줄이면(분 단위) 구글이 차단할 수 있음 — 30분 권장

## 나중에 할 것

- [ ] Firebase Auth 붙이고 Firestore 규칙 잠그기 (지금은 공개 쓰기 가능)
- [ ] 가격 추이 차트 (history 데이터는 이미 쌓고 있음)
- [ ] 네이티브 iOS/macOS 앱 (FCM 전송부는 토큰 기반이라 그대로 재사용 가능)
- [ ] caffeinate 또는 pmset으로 Mac 잠자기 중에도 체크 (필요해지면)
