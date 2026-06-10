# GRANDSLAM (가칭) — LoL 올타임 드래프트 시뮬레이터

## 너의 역할
- 세 SSOT 문서에 등장하는 "Cursor"는 너(Claude Code)를 가리킨다. 파일명 `CURSOR_GUIDE.md`는 유지한다.
- 너는 구현 에이전트다. 기획·디자인·수치 결정을 하지 않는다 — 결정이 필요하면 멈추고 호빈에게 묻는다.

## 응답·작업 언어
- 모든 응답·주석·커밋 메시지는 한국어 (코드 식별자·UI 영문 고정값은 예외).
- 인사말·칭찬·상투구 없이 본론 즉시 진입. 불확실하면 추측하지 말고 질문.
- 코드 설명은 변경 사유와 영향도만 간결하게. 응답에 이모지 금지.

## 사용자 컨텍스트 (코드 작성 방식에 직접 영향)
- 호빈은 백엔드(Spring/Kotlin) 경험자, **React·프론트엔드·TypeScript는 첫 경험.**
- 따라서 useReducer/useEffect에는 CURSOR_GUIDE §13.4의 **한국어 데이터 플로우 주석 의무.**
- 설명은 짧게, 단 상태 흐름·렌더 타이밍 관련 결정은 1줄 근거를 남긴다.

## SSOT 위계
@CURSOR_GUIDE.md
- `PRD_LoL_AllTime_Draft_v1.md` — 기획 판단의 최종 권위. 기획 해석이 필요할 때 해당 섹션을 읽는다.
- `DESIGN_GUIDE.md` — 색·형태·타이포의 권위. 비주얼 작업(Phase 3, /lab) 시 반드시 읽는다.
- 문서 간 충돌 발견 = 작업 중단 후 보고. 임의 해석으로 진행 금지.

## 행동 규약 (CURSOR_GUIDE §0이 원문이며 우선한다)
- 문서에 없는 기능·P1/P2 선구현 금지. 개선 아이디어는 한 줄 제안만 남긴다.
- 외부 API 필드는 `pipeline-cache/discovery.md`에 기재된 것만 사용한다.
- 허용 라이브러리(§0-5) 외 설치 금지 — eslint/prettier 등 dev 툴링도 호빈 승인 전 금지.
- Fandom 요청은 1초 1건 + User-Agent, 병렬 금지, pipeline-cache 캐시 우선.
- 코드 컨벤션은 §13, 커밋은 §14(빌드 통과 시에만, 기능 단위 즉시 커밋)를 따른다.
- 각 Phase는 §0 보고 포맷으로 보고하고, 호빈 승인 전 다음 Phase 착수 금지.

## 세션 프로토콜 (HANDOFF)
- 세션 시작: 이 파일은 자동 로드된다. **루트의 `HANDOFF.md`를 읽고 "진행 중 / 다음 작업"에서 재개**한다.
- Phase 완료·세션 종료 시: `HANDOFF.md`를 갱신한다 (완료 / 진행 중 / 다음 작업 / 호빈 게이트 대기 / 미해결 이슈).
- 컨텍스트가 무거워지면 먼저 `HANDOFF.md`를 갱신한 뒤 새 세션 전환을 제안한다.
- HANDOFF.md에는 **상태만** 기록한다 — 수치·규칙·스키마를 복제하지 않는다 (원문은 항상 SSOT 3종).

## 호빈(사람) 게이트 — 자동으로 넘어가지 말 것 (출처: §11)
discovery.md 승인(D0) → awards.csv 검수(D1~2, 검수 전 레이팅 빌드 금지) → 누끼 판정(D3)
→ opponents 실값(D3) → crown.png + mark SVG 2종 에셋 수령(D4 전) → DESIGN_GUIDE v1.0 승격(D4)

## 환경
Windows + PowerShell / Node 20+ / Vercel 배포. 모든 명령은 PowerShell 기준으로 제시·실행한다.
