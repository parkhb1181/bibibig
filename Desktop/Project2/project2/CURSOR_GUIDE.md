# CURSOR_GUIDE — LoL 올타임 드래프트 시뮬레이터 구현 가이드

| 항목 | 내용 |
|---|---|
| 버전 | v2.2 (PRD v1.9 기준 · DESIGN_GUIDE v0.6 연동 · §13~15 운영 규율 신설: 코드 컨벤션 / 커밋 규율 / 출시 전 QA) |
| 역할 | **구현 SSOT.** 기획 판단은 PRD_LoL_AllTime_Draft_v1.md **최신 버전**이 우선. 충돌 발견 시 작업 중단 후 보고 |
| 대상 | Cursor (AI 페어 에이전트) |
| 환경 | Windows + PowerShell, Node 20+, 배포는 Vercel |

---

## 0. 절대 규칙 (위반 = 작업 실패)

1. **이 가이드와 PRD에 없는 기능을 만들지 않는다.** 개선 아이디어가 있어도 구현하지 말고 한 줄 제안만 남긴다.
2. **P1/P2 항목을 선구현하지 않는다.** (Expert/Daily 모드, 카드 그리드 OG, 리더보드, localStorage 히스토리 등 전부 금지)
3. **스키마·레이팅 공식·레이어 트리거 규칙·게이트 규칙·등급표를 임의 수정하지 않는다.** 숫자 튜닝은 §9(튜닝 단계)에서만, 지정된 파라미터만.
4. **확신 없는 외부 API 필드명으로 코드를 쓰지 않는다.** Phase 0 검증 절차를 통과한 필드만 사용. 검증 실패 시 멈추고 보고.
5. 허용 라이브러리 외 설치 금지: `next`, `react`, `react-dom`, `tailwindcss`, `typescript`, `tsx`, `zod`, `sharp`, `@aws-sdk/client-s3`, `@vercel/og`(next 내장 ImageResponse 사용 시 불필요). 상태관리/UI킷/i18n 라이브러리 금지. (예외: 이미지 파이프라인 한정으로 Python `rembg` CLI 허용 — 배포 번들 미포함, child_process 호출)
6. **백엔드 금지**: DB, 인증, 세션, 서버 상태 일절 없음. 서버 로직은 ① `api/og` 핸들러 ② `/r`의 `generateMetadata`(메타 생성 한정 — §8.2) **둘뿐**.
7. `.env*` 커밋 금지. 시크릿은 코드에 하드코딩 금지.
8. Fandom API/이미지 요청: **1초당 1요청 스로틀 + User-Agent 헤더 필수** + 실패 시 지수 백오프 3회. 병렬 요청 금지.
9. EA SPORTS FC(舊 FIFA) 카드 레이아웃 모방 금지. 광고/트래킹 SDK 금지 (GA4 제외).
10. 모호하면 **멈추고 질문한다.** 임의 가정으로 진행하지 않는다.

**작업 루프**: 해당 Phase 섹션 정독 → 구현 → DoD 검증 명령 실행 → 결과 보고(아래 포맷) → 승인 후 다음 Phase.

```
[보고 포맷]
Phase N 완료
- 산출물: (파일 경로)
- DoD 검증 결과: (명령 + 출력 요약)
- 이슈/결정 필요 사항: (없으면 "없음")
```

---

## 1. 프로젝트 구조 (이 트리 외 디렉토리 생성 금지)

```
/
├─ scripts/                  # 데이터 파이프라인 (빌드 타임 전용, 배포 미포함)
│  ├─ lib/cargo.ts           # cargoquery 클라이언트 (스로틀·페이지네이션·재시도)
│  ├─ 00-discover.ts         # Phase 0: 스키마 검증
│  ├─ 01-tournaments.ts      # 대회 목록 수집
│  ├─ 02-rosters.ts          # 로스터 도출
│  ├─ 03-results.ts          # 대회 순위 수집
│  ├─ 04-ratings.ts          # 레이팅 산출 (awards.csv 병합)
│  ├─ 05-images.ts           # 사진 다운로드 + webp 변환
│  ├─ 06-upload-r2.ts        # R2 업로드
│  ├─ 07-build.ts            # 최종 JSON 빌드 + zod 검증
│  ├─ 08-anchors.ts          # 앵커 검증 리포트
│  └─ 09-montecarlo.ts       # 시뮬 분포 검증
├─ pipeline-input/
│  └─ awards.csv             # 수상 데이터 (반자동 수집, 사람 검수)
├─ pipeline-cache/           # 원시 응답 캐시 (gitignore)
├─ public/data/              # 최종 JSON (players.json, teams.json, spin-index.json, opponents-2026.json)
├─ src/
│  ├─ app/
│  │  ├─ page.tsx            # 홈 (시작 버튼 + 설명)
│  │  ├─ draft/page.tsx      # 게임 본체 (스핀→픽→시뮬→결과)
│  │  ├─ r/page.tsx          # 공유 결과 페이지 (URL 파라미터 재계산)
│  │  ├─ lab/page.tsx        # 카드 디자인 랩 (개발용 — DESIGN_GUIDE §6 매트릭스)
│  │  ├─ about/page.tsx      # 레이팅 산출 기준 + 면책
│  │  └─ api/og/route.tsx    # 동적 OG (edge runtime)
│  ├─ components/            # PlayerCard, SpinReel, RosterSlots, SimReveal, ResultView, LangToggle
│  ├─ lib/
│  │  ├─ prng.ts             # mulberry32
│  │  ├─ sim.ts              # 순수 함수 시뮬 엔진 (§7)
│  │  ├─ grade.ts            # 등급 판정 (§7.4)
│  │  └─ data.ts             # JSON 로더 + 타입
│  └─ i18n/{en.ts, ko.ts, index.ts}
└─ .env.local                # R2 키 (커밋 금지)
```

스택 고정: **Next.js(App Router) + TypeScript + Tailwind**, 전 페이지 정적/클라이언트 렌더 (`/r`은 쿼리 의존 동적 — generateMetadata 한정 서버 로직 허용). 서버 코드는 `api/og` + `/r` 메타뿐. 다크 테마 1종 고정. **`output: 'export'` 설정 금지** — api/og·`/r` generateMetadata와 비호환 (PRD §9의 "정적 사이트"는 배포 형태 설명이지 export 빌드 지시가 아님).

---

## 2. Phase 0 — Cargo 스키마 검증 (코드 작성 전 필수)

목적: 아래 쿼리를 **실제로 호출**해 응답 필드를 확인하고, 결과를 `pipeline-cache/discovery.md`에 기록한다. 이 기록에 없는 필드는 이후 코드에서 사용 금지.

베이스 URL: `https://lol.fandom.com/api.php?action=cargoquery&format=json`
공통 헤더: `User-Agent: AllTimeDraftBot/1.0 (개인 팬 프로젝트; 연락처 이메일)`

검증 순서:

```
A. 테이블 목록 확인 (브라우저): https://lol.fandom.com/wiki/Special:CargoTables
B. Tournaments 테스트:
   &tables=Tournaments&fields=Name,OverviewPage,Year,League,Region,DateStart,SplitNumber,IsQualifier,IsPlayoffs
   &where=Year="2016" AND League="LCK"&limit=10
C. ScoreboardPlayers 테스트 (로스터 도출용):
   &tables=ScoreboardPlayers&fields=Link,Team,Role,OverviewPage,GameId,Champion
   &where=OverviewPage LIKE "LCK/2016%"&limit=10
D. 순위 테이블 탐색 — 우선순위대로 시도, 첫 성공 테이블 채택:
   1순위 TournamentResults / 2순위 Standings / 3순위 TournamentResults1v1 류 변형
   필요 필드: 팀명, 최종 순위(Place), 대회 식별자(OverviewPage 등)
E. Players 테스트 (사진·국적·한글명):
   &tables=Players&fields=ID,Name,NativeName,NameFull,Image,Country,Role&where=ID="Faker"&limit=1
F. 사진 URL 확인: https://lol.fandom.com/wiki/Special:Filepath/{Image값} 이 302로 실제 이미지에 닿는지 1건 확인
G. 시즌별 선수 사진 테이블 탐색: PlayerImages(또는 유사 명칭) 테이블 존재 확인 — 필요 필드: FileName, 선수 Link, Team, Tournament 또는 SortDate.
   존재 시 §5의 시즌별 사진 매칭에 사용. **부재 시 정지하지 말고 Plan B로 자동 전환 (사전 승인됨)**: MediaWiki
   `action=query&list=allimages&aiprefix={선수ID}` 쿼리로 파일명 컨벤션(`{ID}_{Team}_{Year}` 류)을 동일 스로틀 탐색해
   시즌 매칭 — 시도 결과를 discovery.md에 기록.
   Plan B까지 실패한 경우에만 Players.Image 단일 사진 체제로 폴백하고 보고.
```

**DoD**: discovery.md에 (1) 채택 테이블/필드 목록 (2) 순위 테이블 결정 (3) 샘플 응답 JSON 5건 기록. D·E 중 실패 항목이 있으면 **멈추고 보고** (대안: 위키 페이지 HTML 파싱 — 승인 후에만).

---

## 3. 데이터 스키마 (zod로 구현, 변경 금지)

```ts
// 선수-시즌 (players.json 항목)
type PlayerSeason = {
  id: string;            // `${slug(playerId)}_${year}_${slug(team)}` — slugify: 소문자화 → 영숫자 외 문자를 하이픈으로 → 연속 하이픈 축약 → 양끝 제거
                         // zod: /^[a-z0-9-]+_\d{4}_[a-z0-9-]+$/ . 원본 표기는 nameEn/team에 보존.
                         // URL p 파라미터·이미지 파일명·players.json 3곳 모두 이 id만 사용 (예: "Hans Sama" → hans-sama_2019_g2-esports)
  playerId: string;      // Leaguepedia ID (예: "Faker")
  nameEn: string;
  nameKo: string | null; // NativeName 없으면 null → UI는 EN 폴백
  team: string;          // 해당 연도 표기 팀명 (예: "SK Telecom T1")
  teamSlug: string;
  year: number;          // 2013~2025 (2026 진행 시즌 제외 — zod 범위도 동일)
  league: "LCK"|"LPL"|"LEC"|"LCS";
  role: "TOP"|"JGL"|"MID"|"ADC"|"SUP";
  ovr: number;           // 60~99 정수
  frame: "WORLDS"|"NORMAL";    // Worlds 우승 시즌만 WORLDS (시머 프레임)
  crown: boolean;              // 해당 시즌 FINALS_MVP 또는 WORLDS_MVP 수상 시 true (SEASON_MVP 제외) — 왕관은 항상 1개
  msiWinner: boolean;          // MSI 우승 시즌 → "MSI WINNER" 라벨
  photo: string | null;  // R2 공개 URL, 없으면 null
  badges: ("LEAGUE_CHAMP"|"ALLPRO_1ST")[];  // 최대 2개 (Worlds·MSI·MVP는 frame/crown/msiWinner가 담당)
};

// 팀-연도 (teams.json 항목) — 스핀의 추첨 단위
type TeamYear = {
  key: string;           // `${teamSlug}_${year}`
  team: string; teamSlug: string; year: number; league: string;
  roster: string[];      // PlayerSeason.id 배열
  rolesAvailable: Role[];// spin-index의 원천
  weight: number;        // 가중 스핀용 — 빌드 타임 산출: Worlds 우승 8 / Worlds 진출·국내 우승 4 / 플옵 2 / 그 외 1 (§9 튜닝)
};

// spin-index.json: { [role in Role]: string[] /* 해당 role 보유 TeamYear.key 목록 */ }

// opponents-2026.json — 시뮬 상대는 글로벌 고정 봇 풀 2개 (리그 매칭 없음, v1.3)
type Opponent = { name: string; league: string /* 표시용 플레이버 */; rating: number };
type OpponentsFile = { regular: Opponent[]; intl: Opponent[] };
// zod 강제: regular.length === 9 (정규 시즌 상대), intl.length >= 12 (MSI/Worlds 추첨 풀). 두 풀 간 팀 중복 허용

// pipeline-input/awards.csv 컬럼 (헤더 고정)
// playerId,year,league,award,value
// award ∈ SEASON_MVP|FINALS_MVP|WORLDS_MVP|ALLPRO_1ST|ALLPRO_2ND|ALLPRO_3RD|EDITORIAL
// value는 EDITORIAL 전용(±1~5 정수, 앵커 보정 한정·최대 10건), 그 외 award는 공란
```

로스터 도출 규칙 (PRD §4.4): (팀, 대회, 선수, 역할)별 출전 경기 수 집계 → 같은 포지션에 복수 선수면 **5경기 이상 전원 포함, 미만이면 최다 출전자만**. 연도 단위로 스플릿 통합(같은 팀·연도의 스프링/서머 로스터 합집합). **선발은 결정론적으로**: 출전 경기 수 내림차순 → 동률 시 playerId 알파벳 오름차순. 동일 입력에서 빌드 산출물은 항상 비트 단위 동일해야 한다 (정합성 검증의 전제).

---

## 4. Phase 1 — 파이프라인 (scripts 01~04, 07)

### 4.1 cargo.ts 클라이언트 요구사항

- **쿼리 분할이 기본 전략 (v1.2)**: 전체 테이블을 deep-offset으로 순회하지 않는다 (Cargo는 offset 윈도우에 상한이 있어 대형 테이블에서 수집이 붕괴). 모든 수집은 **(리그 × 연도) 단위 WHERE 분할**, 행이 많은 `ScoreboardPlayers`는 **(대회 OverviewPage) 단위**까지 분할. 분할 내부에서만 `limit=500`+`offset` 사용, 한 분할이 수천 행에 근접하면 추가 분할.
- 호출 간 1000ms sleep, 실패 시 2s/4s/8s 백오프 후 중단·보고.
- 모든 원시 응답을 `pipeline-cache/`에 파일 캐시 (재실행 시 캐시 우선 — Fandom 재호출 최소화).

### 4.2 수집 범위 (하드코딩 상수)

```ts
const LEAGUES = ["LCK","LPL","LEC","LCS"];           // 시대별 리그명 매핑은 Phase 0에서 확정 — EU: EU LCS(2013~2018)→LEC(2019~), NA: NA LCS/LCS(2013~2024)→LTA North(2025~). Tournaments.League 실제 값 기준으로 매핑 테이블 고정
const YEARS = { from: 2013, to: 2025 };               // 2026 진행 시즌 제외 (성적 미완결 — Worlds 업데이트 시 추가)
const INTL = ["Worlds", "MSI"];                       // First Stand 제외 (PRD Q4)
```

### 4.3 레이팅 산출 (04-ratings.ts) — PRD §6.1 v1 공식 그대로

```
base 60
+ 국내 플옵 최종 순위: 1위 +10 / 2위 +6 / 3~4위 +3 / 5~6위 +3 / 7위 이하 +1   (연내 복수 스플릿 가점 합산 — 중복제거 없음)
+ MSI: 1위 +8 / 2위 +5 / 3~4위 +3
+ Worlds: 1위 +15 / 2위 +10 / 3~4위 +7 / 5~8위 +4 / 진출 +2
+ awards.csv: SEASON_MVP +6 / FINALS_MVP +4 / WORLDS_MVP +8 / ALLPRO_1ST +5 / 2ND +3 / 3RD +1 (AllPro는 2020+ 시즌만 — 제도 부재 이전 미적용)
+ EDITORIAL: value 그대로 가산 (±1~5, 앵커 보정 전용 — PRD §6.1)
clamp(60, 99)
```
※ 가중치 수치는 PRD §6.2 D0 수기 계산으로 확정된 값을 따른다 — 본 가이드와 PRD 수치가 다르면 PRD 우선.

같은 선수가 연내 이적 시: 팀별 PlayerSeason 분리, 성적 가점은 해당 팀 소속 기간 대회만.

### 4.4 awards.csv 작성 절차 (반자동)

1. Cursor가 각 리그의 시즌 MVP / All-Pro / Finals MVP / Worlds·MSI MVP 위키 문서를 열람해 CSV 초안 생성 (소스 URL을 CSV 주석 1행에 기록).
2. **사람(호빈) 검수 후 확정** — 검수 전 레이팅 빌드에 사용 금지. 초안 완성 시 보고하고 대기.

### 4.5 DoD (Phase 1)

```
npx tsx scripts/07-build.ts 성공 (zod 통과)
players.json 건수 ≥ 3,000 / teams.json ≥ 550 (추정치 ~600과 임계 분리 — 미달 시 실패가 아니라 리그·연도별 결손 리포트로 보고) / 각 리그·연도 누락 0 (리포트 표 출력)
spin-index.json: 5개 role 키 모두 존재, 각 배열 길이 > 0
opponents-2026.json: D0 플레이스홀더 기준으로 zod 통과 (실값 교체는 D3 — §9)
```

---

## 5. Phase 2 — 이미지 파이프라인 (05, 06)

1. **시즌별(era-correct) 사진 매칭 (v1.3)**: Phase 0-G에서 확정한 시대별 사진 테이블에서 각 PlayerSeason의 파일 선택 — 우선순위: ① 같은 팀 + 같은 연도 → ② 같은 팀 + 최근접 연도 → ③ `Players.Image`(현재 프로필) → ④ 아바타 폴백. 후보가 복수면 IsProfileImage=1 우선 → Tournament 명 연도 파싱 내림차순 → FileName 오름차순 (결정론 — SortDate는 전수 공란 확인으로 미사용, Tournament 공란 행은 연도 미상 최하순위). 선택 파일은 MediaWiki imageinfo/allimages API로 CDN URL을 해석해 다운로드 (Special:Filepath는 403 확인으로 미사용. 1초 1건, 실패 시 다음 폴백으로 — 재시도 강박 금지). **다운로드는 D2 야간 배치** (1rps × 수천 건 = 1~2시간+). 파일별 원 출처 URL·원 파일명을 `pipeline-cache/image-sources.json`에 보존 — 사진은 CC가 아닌 권리자 저작물이므로 출처 추적은 테이크다운 선별 대응의 전제.
2. **누끼(배경 제거) 샘플 테스트 (v1.8)**: 전량 처리 전, 시대별 층화 랜덤 100장을 rembg(사람 전용 모델)로 배경 제거 → **파이프라인이 `pipeline-cache/cutout-sample.html` 정적 그리드 1장을 출력** (/lab 불요 — /lab은 D4 산출물) → **호빈 육안 판정 대기 (늦어도 D3 종결 — 카드 컴포지션·이미지 스펙이 이 판정에 의존).** 판정 기준(사전 고정): 치명 결함률 10% 미만 → 전면 채택 / 특정 시대 편중 → 연도 게이트(예: 2017+만 누끼) / 그 이상 → 누끼 포기(DESIGN_GUIDE 레시피 v3 사각+페이드 유지). **채택 단위는 전체 또는 연도 게이트(상수 1개)만 — 카드별 혼재 금지.**
3. 승인 범위에 한해 전량 누끼 → sharp: 투명 여백 트리밍 + 긴 변 320px 리사이즈, **webp q80 알파 유지**, 파일명 **`{id}.webp`** (§3의 slugify 적용된 id — 공백·특수문자 파일명 금지). 누끼 제외 범위는 256×256 cover crop.
4. R2 업로드: `@aws-sdk/client-s3`, endpoint `https://{ACCOUNT_ID}.r2.cloudflarestorage.com`. 환경변수: `R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_BASE_URL` (.env.local). 업로드 후 players.json의 photo에 `{R2_PUBLIC_BASE_URL}/{파일명}` 기록.
5. 사진 킬스위치: 프론트는 `NEXT_PUBLIC_PHOTOS_ENABLED !== "false"`일 때만 photo 사용, 아니면 전원 아바타 폴백.

**DoD**: 업로드 성공률 리포트 (목표 ≥ 70%, 미달이어도 진행 — 폴백 있음). 임의 샘플 5건 R2 URL 브라우저 로드 확인.

---

## 6. Phase 3 — 게임 프론트 (draft 페이지)

### 6.1 상태 머신 (이 순서 외 전이 금지)

```
IDLE → SPIN(roundN) → PICK(roundN) → [round<5 ? SPIN(round+1) : SIM] → REVEAL → RESULT
```

- 라운드 순서: 포지션 고정 아님. 매 스핀의 풀은 **2단 필터 (v1.4)**:
  ① 빌드 타임 인덱스: `base = union(spinIndex[role] for role in emptyRoles)` 중복 제거 (PRD §4.2-5)
  ② **런타임 유효성 필터 (소프트락 방지)**: base 중 "빈 슬롯 포지션이면서 `playerId ∉ 이미 픽한 playerId 집합`인 선수를 1명 이상 보유한 TeamYear"만 최종 풀에 포함 — 이미 뽑은 선수의 다른 연도 버전만 남은 로스터가 스핀되는 막힘을 차단 (실존 케이스: 포지션 스왑 선수). 필터는 `Map<id, PlayerSeason>` 1회 구축 후 수행 — 수천 건 × 로스터 ~7명 수준이라 비용 무시 가능.
- **가중 추첨 (v2.0)**: 최종 풀에서의 추첨은 균등이 아니라 `TeamYear.weight` 비례 가중 샘플링 (draftRng 사용 — 누적합 + 이진 탐색, 결정론·Daily 시드 재현성 유지). 리롤 재추첨도 동일 가중 적용.
- **PRNG 2개 분리 (v1.2 — 단일 스트림 공유 금지)**: `draftRng = mulberry32(seed)`는 스핀·리롤에만 사용. 시뮬은 `simulate()` 내부에서 `simRng = mulberry32((seed ^ 0x9E3779B9) >>> 0)`을 **새로 생성**. 이유: 스핀·리롤 횟수에 따라 스트림 소비량이 달라지므로 하나의 스트림을 공유하면 `/r` 공유 페이지의 재계산이 인게임 결과와 달라짐. 시뮬은 (picks, seed)만으로 100% 재현되어야 한다.
- seed는 유저가 **시작 버튼을 누르는 클릭 핸들러에서** `crypto.getRandomValues(new Uint32Array(1))[0]`로 1회 생성 (TypedArray 인자 필수 — 32비트 정수 시드). SSR/초기 렌더 시점에 난수를 생성하거나 렌더에 반영하지 않는다 (Hydration 불일치 방지) — 초기 렌더는 IDLE 빈 슬롯 고정.
- 리롤: 팀 리롤 1회(연도 유지·팀 재추첨), 연도 리롤 1회(팀 유지·연도 재추첨). 재추첨도 위 2단 필터를 통과한 풀 내에서만. 제약(연도/팀 고정)을 적용한 부분집합이 **공집합이면 제약을 풀고 전체 유효 풀에서 추첨** (락 방지 우선). 둘 다 소진 시 버튼 비활성.
- 픽 화면: 해당 TeamYear 로스터를 PlayerCard 그리드로 표시. 이미 채워진 포지션·이미 픽한 선수는 비활성(회색+잠금 아이콘).

### 6.2 PlayerCard (PRD §6.4 — 단일 컴포넌트, 3가지 size variant: pick / slot / result)

- 좌상단 OVR(카드 내 최대 폰트) + 그 아래 포지션 약어. 중앙 사진(없으면 이니셜+팀컬러 그라디언트 아바타). 하단 이름(언어 토글 연동) + `팀 · 연도`.
- **장식 레이어 (data 플래그 → CSS 모디파이어 클래스, 전부 중첩 가능):**
  - `frame === "WORLDS"`: 그라디언트 보더 + 시머 스윕 애니메이션 — **사이트 전체에서 유일한 반짝이 처리.** 그 외 전부 일반 다크 프레임 1종 (화면의 95%+이므로 일반 프레임 완성도 최우선).
  - `crown === true`: **고정 에셋 `/public/crown.png` 1개**를 사진 좌상단에 -12° 회전 오버레이. 에셋 제작은 DESIGN_GUIDE §4.2 절차(호빈 손그림 투명 PNG 우선) — Cursor가 **생성·보정·변형·교체하지 않는다.** 외부 클립아트·아이콘 팩 사용 금지.
  - `msiWinner === true`: 사진 하단 소형 캡슐 라벨 `MSI WINNER` (영문 고정, i18n 제외).
  - `badges`: 우상단 아이콘 최대 2개 (리그 우승 / All-Pro 1st만).
- 색·재질·타이포·금지 규칙은 **DESIGN_GUIDE.md가 비주얼 SSOT** (구조·트리거는 본 가이드 우선). 토큰이 TBD인 동안 임의 색상값 하드코딩 금지 — lab 수렴 후 토큰으로만 사용.
- 카드는 **세로 5:7 라운드 사각** (DESIGN_GUIDE §3-1). 금지는 EA 고유 식별 요소(방패형/펜타곤 실루엣, 특유 텍스처)만 — 세로 비율·좌상단 OVR 등 카드 문법은 그대로 사용.

### 6.3 i18n

- `src/i18n/{en,ko}.ts` 딕셔너리 + Context. 토글은 헤더 우상단, 선택값 localStorage `lang` 키 1개만 저장(이 외 localStorage 사용 금지). 기본값: `navigator.language`가 ko면 ko, 아니면 en. **Hydration 규칙**: 첫 렌더는 en 고정(서버와 동일 상태), mount 후 useEffect에서 localStorage `lang` → `navigator.language` 순으로 반영 — lazy init·컴포넌트 본문에서 두 API 직접 접근 금지 (§13.5).

**DoD**: 시드 고정 테스트 — 동일 seed 입력 시 5회 연속 동일 스핀 시퀀스 재현. 모바일 뷰포트(390px)에서 픽 그리드 가로 스크롤 없음.

---

## 7. 시뮬 엔진 (lib/sim.ts — 순수 함수, UI 의존 금지)

```ts
simulate(picks: PlayerSeason[5], opponents: Opponent[], seed: number): SimResult
```

### 7.1 전력 계산

```
teamPower = Σ ovr × w[role],  w = {MID:1.10, JGL:1.10, ADC:1.00, TOP:0.95, SUP:0.85} (합 5.0)
teamOvr = teamPower / 5                       // 60~99 스케일로 정규화. 표시는 round(teamOvr)
게임 승률 P(win) = 1 / (1 + 10^((oppRating − teamOvr) / S)),  S 초기값 40 (§9 튜닝 파라미터)
                                              // 양변 모두 60~99 평균 스케일 — teamPower(합산값)를 직접 넣지 말 것
시리즈: Bo1=1게임, Bo3=2선승, Bo5=3선승 — 게임 단위 난수 (simRng만 사용, §6.1)
```

### 7.2 캠페인 구조 (고정 — 변경 금지)

```
[Split 1] 정규: `regular` 풀 9팀(글로벌 고정 — 리그 매칭·패딩 로직 없음)과 각 2회 Bo1 = 18경기 (유저전만 실제 시뮬)
          → 순위 산출: 봇 간 72경기는 시뮬하지 않고 레이팅 기대값으로 승수 부여
             botWins_i = 2 × Σ_j P(rating_i vs rating_j) + (유저전 2경기 중 해당 봇이 이긴 수)
             ※ 기대값 합이 자동으로 총 경기 수와 일치 — 별도 expectedWins 데이터 불요
          → 10팀을 승수 내림차순 정렬(동률은 rating 내림차순), 유저 4위 이내면 플옵 (4강 Bo5 → 결승 Bo5)
             플옵 대진은 정규 순위 기준 **1위 vs 4위 / 2위 vs 3위** 고정, 승자끼리 결승 (결정론)
[MSI]     게이트: Split1 결승 진출 시에만. 8팀 Bo5 싱글엘림 3라운드 (상대: `intl` 풀에서 **비복원 추첨**)
[Split 2] Split 1과 동일 구조 반복 (화면엔 요약 1줄 + 플옵만 상세)
[Worlds]  게이트: Split2 플옵 4강 이상. 스위스 Bo3 — 3승 진출/3패 탈락 (최대 5라운드)
          → 진출 시 8강/4강/결승 Bo5 (스위스·녹아웃 전 라운드 상대는 `intl` 풀 **비복원 추첨**)

※ 국제전 추첨 규칙: 단일 대회 내 **비복원 추출** — 추첨된 팀은 해당 대회의 로컬 풀 복사본에서 제거(simRng 사용),
   같은 대회에서 동일 상대와 재대결 금지. 대회 종료 시 풀 리셋 — MSI에서 만난 팀이 Worlds에 등장하는 것은 허용.
   최대 소요 8팀(스위스 5 + 녹아웃 3) < intl 12팀이므로 풀 고갈 불가.
```

### 7.3 SimResult (REVEAL 마일스톤 = 이 배열 순서대로 표시)

```ts
{ steps: Array<{stage: string; label: string; series?: {opp: string; score: string; win: boolean}[]}>,
  trophies: ("SPLIT1"|"MSI"|"SPLIT2"|"WORLDS")[],
  grade: Grade, teamOvr: number }
```

### 7.4 등급표 (grade.ts — 고정)

| Grade | 조건 |
|---|---|
| GRAND SLAM | 4개 트로피 전부 |
| LEGENDARY | Worlds 우승 (슬램 미달) |
| ELITE | MSI 우승 또는 국내 2회 우승 |
| CONTENDER | 국내 우승 1회 또는 Worlds 4강+ |
| PLAYOFF TEAM | 플옵 또는 Worlds 진출 |
| REBUILD | 그 외 |

REVEAL: steps를 600ms 간격 순차 표시, `Skip` 버튼은 즉시 RESULT로. 연산은 동기 일괄 수행(1초 미만 — 18+α 경기 난수라 사실상 즉시).

**DoD**: `09-montecarlo.ts` — 픽 정책 2종 × 각 10,000회: ① **그리디**(노출 로스터에서 빈 슬롯 채울 수 있는 최고 OVR 선택 — 실제 유저 근사, **목표 판정 기준**) ② 균등 랜덤(베이스라인). 스핀은 §6.1의 **가중 샘플링을 동일 적용**. 등급 분포 표 2개 + 유명 팀(weight ≥ 4) 스핀 비율 출력. 목표(PRD §5.3): 그리디 기준으로 전원 95+ 픽의 GRAND SLAM 비율 15~25%, 평균 픽은 PLAYOFF~CONTENDER 중심. 미달 시 §9 파라미터만 조정.

---

## 8. 공유 — URL · OG (P0 범위 엄수)

### 8.1 결과 URL (무 DB 영속화의 핵심)

```
/r?p={id1}.{id2}.{id3}.{id4}.{id5}&s={seed}
p: PlayerSeason.id 5개, 순서 TOP.JGL.MID.ADC.SUP 고정 / s: 시뮬 seed (10진수)
```

`/r` 페이지는 파라미터로 picks 복원 → `simulate()` **재계산** → 동일 결과 렌더 (결과 자체를 URL에 넣지 않는다 — 시드 재계산이 위변조 방지와 URL 길이를 동시에 해결). 재계산은 인게임과 동일한 `simulate()` 코드 경로를 타며, §6.1의 simRng 파생 규칙 덕에 스핀·리롤 횟수와 무관하게 **비트 단위 동일 결과**가 보장된다. 잘못된 id/seed는 홈으로 리다이렉트.

### 8.2 OG 이미지 (api/og/route.tsx, edge)

- **OG 라우트는 시뮬·데이터 조회를 하지 않는다 (v1.2)**: players.json(수 MB)은 edge 번들에 포함 불가. `/r`의 `generateMetadata`(Node 런타임)가 데이터 로드 + `simulate()` 재계산을 수행하고 **표시값만** 쿼리로 전달 → `/api/og?g={grade}&t={trophies}&ovr={teamOvr}&l1..l5={이름(EN)·포지션·OVR}`. edge 라우트는 받은 문자열로 **타이포 전용** 1200×630 렌더만 수행 (등급 최대 크기 / 트로피 라인 / 팀 OVR / 5인 텍스트 행 / 등급별 컬러 배경). OG 파라미터 위변조는 무해 — `/r` 본문은 항상 p·s로 진실을 재계산한다.
- og URL 조립은 **`URLSearchParams`로 직렬화** (템플릿 리터럴 수동 조립 금지) — `GRAND SLAM`의 공백 등 특수문자 인코딩 누락을 원천 차단. edge 라우트의 파라미터 파싱도 `req.nextUrl.searchParams`만 사용.
- **이미지·한글 폰트 사용 금지** (edge 번들 500KB 제한). 폰트: Inter 라틴 서브셋 1종만 로컬 포함.
- `/r` 페이지 `generateMetadata`에서 og:image로 연결. DoD: 카톡/디스코드 미리보기 시뮬레이터(또는 opengraph.xyz)에서 렌더 확인.

### 8.3 결과 화면 버튼

`Copy Link`(클립보드) / `Share`(navigator.share, 미지원 브라우저는 숨김) / `Play Again`. X/카톡 개별 버튼 만들지 않는다.

---

## 9. 튜닝 단계 (조정 허용 파라미터 — 이 목록 외 수정 금지)

1. Elo 스케일 `S` (초기 40)
2. `opponents-2026.json`의 팀 구성·rating 값 — **regular 정확히 9팀**(zod로 강제, 1~3티어 혼합: 92~94 / 88~91 / 84~87 / 하위 78~83), **intl 12팀 내외**(상위권 위주). **D0에 스키마를 충족하는 플레이스홀더를 생성**하고, D3에 호빈이 실명·확정값으로 교체 (스키마는 D0부터 항상 충족 — 빌드·검증 경로 단일 유지). 두 풀 간 중복 허용
3. 레이팅 공식의 가점 수치 (§4.3) — **앵커 검증(08-anchors.ts) 결과가 어긋날 때만**. 앵커 목표값은 PRD §6.2 (시대별 현실화 버전)를 따른다
4. 스핀 가중치 `TeamYear.weight` 산출 계수 (초안: Worlds 우승 8 / Worlds 진출·국내 우승 4 / 플옵 2 / 그 외 1) — 몬테카를로의 그리디 분포와 체감 유명 팀 비율(목표 50~60%)을 보고 조정

튜닝 후 반드시 08·09 스크립트 재실행 → 표를 보고에 첨부.

---

## 10. 법적·면책 구현 사항 (PRD §10)

- 전 페이지 푸터: `"{서비스명} is a fan-made project. Not affiliated with or endorsed by Riot Games. League of Legends is a trademark of Riot Games, Inc."` + KR 병기. About 페이지에 레이팅 산출 기준 요약 + 데이터 출처(Leaguepedia) + 문의 메일.
- 수익화·광고 코드 작성 금지. GA4 스니펫만 (이벤트: `spin_start, draft_complete, sim_complete, share_click, lang_toggle`).

---

## 11. Phase 순서 · 일정 매핑 (PRD §11)

| Phase | 내용 | 일정 | 게이트 |
|---|---|---|---|
| 0 | Cargo 스키마 검증 + `opponents-2026.json` 플레이스홀더 생성(regular 9·intl 12, 스키마 충족 임시값) | D0 | discovery.md 승인 |
| 1 | 파이프라인 01~04, 07 | D1~2 | 건수 리포트 + awards.csv 검수 승인 |
| 2 | 이미지 다운로드(D2 야간 배치) → 누끼 샘플 정적 HTML → R2 | D2~3 | 샘플 URL 확인 + **누끼 판정 종결(호빈, D3까지)** |
| 3 | /lab + PlayerCard(**CSS 변수로만 색 수신** — lab 변주 = 변수 오버라이드) → 토큰 토너먼트 → draft 상태머신·스핀·픽·리빌·결과 | D4(lab·카드)~D5(draft) | 시드 재현 테스트 + DESIGN_GUIDE v1.0 승격 |
| 4 | 시뮬 엔진 + 등급 + 몬테카를로 — **순수 함수라 UI 불요, D3 선행 구현** | D3 | 몬테카를로 분포 (그리디+균등) |
| 5 | URL/OG/i18n/면책/GA4 | D6 | OG 미리보기 확인 |
| 6 | 튜닝 + QA + 배포 | D3, D7 | 앵커 표 + 모바일 QA |

파이프라인이 D2까지 미완이면 즉시 보고 — 범위를 LCK+국제전으로 축소하는 결정은 호빈만 내린다.

---

## 12. 금지 사항 최종 체크리스트 (PR 전 자가 점검)

- [ ] PRD/가이드 외 기능 없음 · P1/P2 선구현 없음
- [ ] 허용 외 라이브러리 없음 · DB/백엔드 없음 (api/og + /r generateMetadata 제외)
- [ ] 스키마·공식·등급표·게이트 무변경 (튜닝 파라미터 제외)
- [ ] localStorage는 `lang` 키 1개뿐
- [ ] .env 미커밋 · 시크릿 하드코딩 없음
- [ ] Fandom 요청 스로틀 준수 · 캐시 우선
- [ ] EA 카드 레이아웃 비모방 · 광고 코드 없음
- [ ] 푸터 면책 문구 전 페이지 존재
- [ ] §13 코드 컨벤션 · §14 커밋 규율 준수 (빌드 통과 커밋만 존재)

---

## 13. 코드 컨벤션 (전 Phase 공통)

### 13.1 네이밍

| 대상 | 규칙 | 예시 |
|---|---|---|
| 컴포넌트 파일 | `PascalCase.tsx` | `PlayerCard.tsx`, `SpinReel.tsx` |
| 페이지 파일 | `page.tsx` (Next 컨벤션) | `app/draft/page.tsx` |
| 유틸/라이브러리 | `camelCase.ts` | `sim.ts`, `grade.ts` |
| 커스텀 훅 | `useXxx.ts` | `useDraftMachine.ts` |
| 타입/인터페이스 | `PascalCase` | `PlayerSeason`, `SimResult` |
| 상수 | `UPPER_SNAKE_CASE` | `LEAGUES`, `YEARS` |
| JSON 필드 | `camelCase` (§3 스키마 고정) | `msiWinner`, `teamSlug` |

### 13.2 TypeScript

- strict 유지. `any` 금지 — `unknown` + 타입 가드. enum 대신 union 타입 (§3 스키마와 동일 방식).
- `as` / `!`(non-null assertion) 사용 시 사유 주석 1줄 필수.
- 컴포넌트는 `export default function` 선언으로 통일 (화살표 함수 컴포넌트 금지 — 유틸·훅·내부 헬퍼는 화살표 허용).
- 클라이언트 훅 사용 파일은 최상단 `'use client'` 누락 금지.
- import 순서: react/next → 내부 컴포넌트(`@/`) → lib·상수 → 타입(`import type`) → JSON 데이터. 그룹 간 빈 줄 1개.

### 13.3 구조 원칙 (MVP)

- 과도한 추상화 금지, 직접 작성 우선. §1 트리 외 폴더·계층 임의 추가 금지(절대규칙 1과 동일 효력).
- 컴포넌트 분리는 **3회 이상 재사용 시에만** — 그 전엔 같은 파일 내 헬퍼로 유지.
- `try-catch`는 외부 경계(fetch, JSON 파싱, localStorage)에서만. 일반 로직은 사전 검증.
- `console.log`는 커밋 전 제거 (`console.error`는 허용).

### 13.4 React 데이터 플로우 주석 (의무)

호빈은 백엔드 경험자이나 **React·프론트엔드는 첫 경험** — 상태 추적 가능한 한국어 인라인 주석을 강제한다.

- `useReducer`: 액션별 상태 변화를 주석으로 (draft 상태머신 §6.1이 주 대상 — SPIN/PICK/REROLL/SIM 등 액션별 1줄).
- `useEffect`: dependency 1개 이상이면 트리거 조건·동작 주석.
- 커스텀 훅: 외부 노출 인터페이스에 JSDoc 1블록.

### 13.5 Hydration 방어 (전 페이지 공통 원칙)

- 초기 렌더는 항상 서버와 동일한 상태 — **lazy init·컴포넌트 본문에서 localStorage / navigator / crypto 접근 금지.**
- 영속·브라우저 값은 mount 후 useEffect에서 반영. seed 생성 규칙은 §6.1, 언어 초기값은 §6.3을 따른다.
- `useSearchParams`를 쓰는 클라이언트 컴포넌트는 **Suspense 경계 내부**에 배치 (page는 wrapper 역할만). `/r`은 가능하면 서버 컴포넌트의 `searchParams` prop으로 처리해 클라이언트 훅 의존을 줄인다.

### 13.6 빌드 에러 시 우선 의심 순서

`'use client'` 누락 → useSearchParams Suspense 미적용 → edge(api/og) 번들 초과(이미지·한글 폰트 import 혼입) → generateMetadata 내 클라이언트 API 접근 → zod 스키마 불일치.

---

## 14. Git 커밋 규율 (AI 작업 롤백 안전망)

- **단위**: 기능 1개(또는 파일 1~3개)가 완성되고 **빌드가 통과할 때마다 즉시 커밋.** 깨진 빌드·미완성 상태 커밋 금지, "오전 작업분 일괄" 식 몰아치기 커밋 금지.
- 한 작업의 디프가 5개 파일을 넘길 것 같으면 분할 계획을 먼저 보고.
- **메시지**: Conventional Commits, 한국어, 50자 이내, 명령형(과거형 금지), 마침표 없음.

| Type | 사용 시점 |
|---|---|
| `feat:` | 신규 기능 |
| `fix:` | 버그 수정 |
| `refactor:` | 동작 불변 개선 |
| `style:` | 포맷팅·클래스 정렬 |
| `docs:` | 문서·주석 |
| `chore:` | 설정·의존성 |
| `data:` | JSON·awards.csv 변경 |
| `pipeline:` | scripts 01~09 변경 |
| `tune:` | §9 튜닝 파라미터 변경 — **08·09 재실행 결과 요약을 body에 첨부** |

- **Phase 완료는 단독 커밋**으로 마감 (예: `feat: Phase 1 파이프라인 완료 (DoD 통과)`).
- 문제 발생 시 디버깅보다 **마지막 정상 커밋 롤백을 먼저 검토** (`git log --oneline` → `git reset`).

---

## 15. 출시 전 QA 체크리스트 (Phase 6 · D7 게이트)

상태·재현성
- [ ] 동일 seed 5회 → 스핀 시퀀스·시뮬 결과 동일 (§6 DoD 재확인)
- [ ] 스핀/리롤/픽 버튼 연타 10회 — 상태머신 불법 전이·중복 픽 없음
- [ ] 리롤 2종 소진 후 버튼 비활성

공유 경로
- [ ] 결과 → Copy Link → 새 탭 `/r` 재계산 결과가 인게임과 비트 동일
- [ ] `/r`에 손상 id·seed 입력 → 홈 리다이렉트
- [ ] OG 미리보기(opengraph.xyz): `GRAND SLAM` 공백 인코딩 / 등급 컬러 / 5인 텍스트 행
- [ ] navigator.share 미지원 브라우저에서 Share 버튼 숨김

표시·폴백
- [ ] `NEXT_PUBLIC_PHOTOS_ENABLED=false` 빌드 → 전원 아바타 폴백
- [ ] 사진 없는 카드 폴백이 사진 카드와 동일 채도 레벨 (DESIGN §3-8)
- [ ] 풀스택 카드(WORLDS 프레임 + 왕관 + 마크 2종 오버랩 + 배지, 예: Faker 2016) 3사이즈 렌더 — slot에서 마크 식별 가능
- [ ] EN/KR 토글 → 새로고침 후 유지, 첫 렌더 hydration 경고 없음

성능·기타
- [ ] 시뮬 연산 1초 미만, Skip 즉시 RESULT
- [ ] 390px 뷰포트 — 픽 그리드·결과 화면 가로 스크롤 없음
- [ ] GA4 이벤트 5종 발화 (`spin_start, draft_complete, sim_complete, share_click, lang_toggle`)
- [ ] 전 페이지 푸터 면책 + About 산출 기준 페이지
- [ ] zod 강제 동작 확인 (opponents regular 정확히 9팀)

---

*본 가이드는 구현 절차의 SSOT. 기획 변경은 PRD 최신 버전 수정 → 본 가이드 갱신 순서로만 진행한다.*
