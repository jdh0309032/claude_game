# 🛵 Grab Rider — 3D 배달 러너

그랩(Grab) 배달 라이더 컨셉의 3D 러너 게임입니다. 그린 재킷과 배달 박스를 단 라이더가 도로 위 자동차들 사이를 비집고 달립니다.
메뉴·HUD·팝업은 배달 앱처럼 그린 헤더 + 흰 카드 + 하단 시트 스타일로 구성했습니다.
모바일(터치)과 PC(키보드) 둘 다 지원하며, 브라우저만 있으면 설치 없이 바로 플레이할 수 있습니다.

## 실행 방법

ES 모듈을 사용하므로 `file://`로 직접 열지 말고 정적 웹 서버로 띄워야 합니다.

```bash
# 저장소 루트에서
python3 -m http.server 8000
# 브라우저에서 http://localhost:8000 접속
```

- 같은 Wi-Fi의 휴대폰에서 `http://<PC의 IP>:8000`으로 접속하면 모바일에서 테스트할 수 있습니다.
- GitHub Pages 등 아무 정적 호스팅에 그대로 올려도 동작합니다 (빌드 과정 없음).
- Three.js는 `vendor/`에 포함되어 있어 오프라인에서도 실행됩니다.

## 조작법

| 동작 | 키보드 | 터치 |
| --- | --- | --- |
| 좌/우 조향 | ← → 또는 A D | 왼손: ◀ ▶ 버튼 (설정에서 *DRAG PAD*로 변경 가능) |
| 가속 | ↑ 또는 W | 오른손: 핸들 그립 모양 **THROTTLE** (누르면 그립이 감기고 속도계에 붉은 RPM 아크) |
| 브레이크 | ↓ 또는 S | 오른손: 디스크/메탈 레버 **BRAKE** (붉은 하이라이트 + 화면 외곽·후미등 글로우) |
| 니트로 | Space / Shift | 오른손 위쪽: **NOS** 스위치 (100% 충전 시 시안 네온 펄스) |
| 일시정지 | P / Esc | 우측 상단 ❚❚ |
| 시작 / 재시작 | Enter | 버튼 |

- 버튼마다 포인터 ID를 따로 추적하므로 조향·가속·브레이크·니트로를 동시에 누를 수 있습니다.
- 설정의 **가속 방식**: *자동 가속*(기본, THROTTLE은 최고속 가속) / *수동*(THROTTLE을 누르고 있어야 가속).

## UI · 사운드

- 게임 UI는 글로벌 영문(`NEAR MISS!`, `WRONG WAY x2`, `DELIVERY RECEIPT`, `CRASHED!` / `DELIVERED!` 등)과 미니멀 라인 아이콘(`js/icons.js`)을 사용합니다.
  결과 화면은 신기록 또는 멀티 승리 시 `DELIVERED!`, 그 외 `CRASHED!` 입니다.
- 엔진음은 이전 대비 약 37% 볼륨, 128 BPM 합성 BGM(킥·클랩·하이햇·베이스·아르페지오)이 깔리며 속도가 오를수록 비트가 촘촘해지고 니트로 때 필터가 열립니다.
- 설정: SOUND FX / MUSIC / VIBRATION / GRAPHICS / **SCREEN WET EFFECT** / THROTTLE / TOUCH STEERING.

## 재미 요소

- **니어미스 & 콤보** — 차 옆을 아슬아슬하게 스치면 보너스. 0.35m 이내는 *PERFECT* (2배). 3초 안에 연속 성공하면 콤보 배율 상승.
- **역주행 차선** — 중앙선 왼쪽 반대 차선은 점수 2배 + 니트로 충전.
- **니트로** — 게이지를 채워 발동. 4초간 최고속 135%, 무적, 부딪힌 차는 날려버리고 *SMASH* 보너스. **발동 중엔 게이지가 차지 않습니다.**
- **견인트럭 점프** — 노란 경사판이 달린 견인트럭에 뒤에서 올라타면 공중 점프. 공중에선 무적, 착지 시 *AIR JUMP* 보너스.
- **스콜(Squall)** — 30초 폭우 이벤트(점수 1.3배, 빗소리·주기적 천둥 번개). 화면에 맺힌 빗물이 중력 방향으로만 흘러내리며 잔상과 굴절을 남깁니다(`js/rainfx.js`, Canvas 2D).
  저사양 기기는 설정에서 *SCREEN WET EFFECT* 를 끄면 되고, 이때도 어두워지는 조명·번개 플래시·하늘을 비추는 물웅덩이로 폭우가 표현됩니다. 물웅덩이를 밟으면 핸들이 둔해지고 미끄러집니다.
- **위험 요소** — 갓길 노점상(Kaki Lima 수레·천막) 충돌, 중앙선 라바콘·공사 표지판, 깜빡이 차선 변경, 중앙선을 침범하는 차량.
- **파워업** — 🛡️ 실드, 🧲 자석, ✨ 점수 x2, ⏳ 슬로우모션.
- **인도네시아 도심 배경** — Ruko(상가주택) 줄, Warung, 야자수, 가로등, 보도. 낮/노을/밤 사이클.
- **차고** — 바이크 5종 + 배달 상자 스킨(기본·스티로폼·네온·보물상자) + 라이더 의상(재킷·우비)·헬멧(그린·풀페이스·레트로·골드).
- **미션 / 이어달리기 / 출석 보상** — 한 판 미션 3개, 코인 150개로 부활, 하루 1회 코인 100개.
- **일시정지 = 배달 주문서** — 영수증 스타일로 주행 기록과 미션 진행률(%)을 보여줍니다.

## 계정 · 글로벌 랭킹 (Supabase)

`js/config.js` 가 비어 있으면 **로컬 모드**로 동작합니다 (계정·랭킹이 이 브라우저에만 저장).
실제 글로벌 랭킹을 쓰려면:

1. [Supabase](https://supabase.com) 프로젝트 생성
2. Authentication → Providers → Email 에서 **Confirm email 끄기** (아이디를 `아이디@grabrider.game` 가상 이메일로 가입시킴)
3. SQL Editor 에서 [`supabase/schema.sql`](supabase/schema.sql) 실행 (랭킹 테이블 + RLS + `submit_score`/`my_rank` 함수)
4. `js/config.js` 에 `SUPABASE_URL`, `SUPABASE_ANON_KEY` 입력

- 로그인 토큰은 localStorage 에 저장되어 자동 로그인되며, 만료 시 refresh token 으로 갱신합니다.
- 게임 오버 시 로그인 상태면 최고 점수가 자동 전송되고 TOP 10 + 내 순위를 표시합니다.
- 점수는 클라이언트에서 계산되므로 조작을 완전히 막을 수는 없습니다 (서버 함수에서 범위만 검증).

## 1v1 멀티플레이 (PeerJS)

- 메뉴 → **1v1 멀티플레이** → 방 만들기(5자리 Room Code) / 코드 입력 후 참가 → 방장이 *대결 시작*.
- 방장이 보낸 **난수 시드**로 두 기기가 같은 교통·라바콘·노점상·물웅덩이·스콜을 생성합니다.
- 방장의 도로 시드는 참가자가 접속하는 즉시 전달되고, 대결 시작 시 다시 확정됩니다(mulberry32 PRNG, 스폰 종류별 스트림).
- 위치·속도·점수는 **최대 15 FPS(≈66ms)** 로 제한해 보내고, DataChannel 버퍼가 64KB 넘게 쌓이면 상태 패킷을 건너뜁니다. 상대는 **반투명 고스트**로 그리고, 둘 다 끝나면 점수로 승패. 재대결 지원.
- ICE 서버: Google STUN 3개 + PeerJS 기본 TURN 릴레이(`js/config.js` 의 `PEER_ICE_SERVERS`). 로그 레벨은 `PEER_DEBUG`(기본 2).
  브라우저 콘솔의 `[net]` 로그로 피어 오픈, ICE 상태, 연결 종료, 오류를 확인할 수 있습니다.
- 중개는 PeerJS 공개 브로커(0.peerjs.com)를 씁니다. 자체 서버는 `js/config.js` 의 `PEER_SERVER` 로 지정하세요.

## 외부 3D 모델

`assets/models/` 에 .glb/.gltf 를 넣고 `js/config.js` 의 `MODEL_CONFIG` 에 경로를 지정하면 기본 로우폴리 모델 대신 사용됩니다.
없거나 로딩 전이면 기존 모델이 그대로 보입니다. 자세한 키 목록은 [`assets/models/README.md`](assets/models/README.md) 참고.

## 파일 구조

```
index.html            화면/HUD/모달 마크업 (로그인, 랭킹, 멀티, 차고 탭, 주문서 일시정지)
css/style.css         앱 스타일 UI + 터치 조작계 레이아웃
js/config.js          Supabase / PeerJS / 외부 3D 모델 설정
js/main.js            게임 루프, 입력, 교통·기믹, 시드 동기화, 멀티플레이, UI 흐름
js/models.js          ModelManager(GLTF 로더) + 로우폴리 모델·텍스처
js/storage.js         저장 데이터, 커스텀 파츠, 미션, 계정 인증, 글로벌 랭킹 API
js/net.js             1v1 연결 (PeerJS)
js/audio.js           WebAudio 합성 효과음 + 128 BPM BGM 시퀀서
js/rainfx.js          화면 빗물 오버레이 (Canvas 2D 굴절)
js/icons.js           미니멀 라인 아이콘 (SVG)
supabase/schema.sql   글로벌 랭킹 DB 스키마
assets/models/        외부 3D 모델 폴더
vendor/               Three.js r160 + GLTFLoader (MIT), PeerJS 1.5.4 (MIT)
```

## 참고

- 글로벌 랭킹은 `js/config.js` 의 Supabase 설정을 사용하고, '내 기기' 탭은 이 브라우저의 로컬 TOP 10 입니다.
- URL에 `?debug`를 붙이면 콘솔에서 `window.__G`로 게임 상태를 확인할 수 있습니다.
- "Grab"은 Grab Holdings의 상표입니다. 개인 학습/팬 프로젝트 용도로 쓰고, 공개 배포·스토어 출시 시에는 `index.html`, `manifest.webmanifest`의 이름을 자체 브랜드로 바꾸세요.
