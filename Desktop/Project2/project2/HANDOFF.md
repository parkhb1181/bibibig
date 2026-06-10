# HANDOFF.md — 세션 인수인계 (Claude Code가 갱신)

> 규칙: Phase 완료·세션 종료 시 Claude Code가 갱신. 새 세션은 이 파일의 "진행 중 / 다음 작업"부터 재개.
> 여기에는 **상태만** 기록한다 — 절차·DoD·수치·스키마는 SSOT 3종이 원문 (복제 금지).

## 현재 상태
- 날짜 / Phase: D1 (2026-06-11) / 02-rosters.ts 백그라운드 실행 중 (b4ys0de8e)
- 빌드 상태: scaffold 완료, TypeScript noEmit 통과 (빌드 미실행)
- 브랜치: main

## 완료
- 스캐폴드: Next.js 15 + TypeScript + Tailwind, src/ 구조
- `public/data/opponents-2026.json` 플레이스홀더 (regular 9팀 / intl 12팀)
- `src/lib/prng.ts` mulberry32 구현
- `scripts/00-discover.ts` Phase 0 전체 (A~G + S1~S4) 실행 완료
- `scripts/00-final.ts` Phase 0 최종 마무리 (T1·S1잔여·SemVal) 실행 완료
- `scripts/00-where-test.ts` 0-a~0-d WHERE 테스트 완료
- `pipeline-cache/discovery.md` 갱신 완료 (gitignored)
- CURSOR_GUIDE_1.md 삭제, CURSOR_GUIDE.md §5 항목1 SortDate→Tournament 연도 파싱 규칙으로 교체

### Phase 0 검증 결과 요약
| 항목 | 결과 |
|---|---|
| LCK League 값 | `"LoL Champions Korea"` |
| LPL League 값 | `"Tencent LoL Pro League"` |
| EU LCS League 값 | `"Europe League Championship Series"` |
| LEC League 값 | `"LoL EMEA Championship"` |
| LCS (2020) League 값 | `"League of Legends Championship Series"` |
| LTA North (2025) League 값 | `"League of Legends Championship of The Americas North"` |
| Worlds 2016 OverviewPage | `"2016 Season World Championship"` |
| MSI 2016 OverviewPage | `"2016 Mid-Season Invitational"` |
| LCK 2016 Summer Playoffs OverviewPage | `"LCK/2016 Season/Summer Playoffs"` |
| TournamentResults 0-b (OverviewPage 정확) | **성공** → Phase 1 착수 조건 충족 |
| TournamentResults 0-d 정규시즌 | **성공 (TournamentResults 채택)** |
| Standings 0-d 정규시즌 | 성공 (동일 데이터 — TournamentResults 우선) |
| 0-c LCK/2016 Summer Playoffs Place=1 | ⚠️ 행 없음 (0-c LIKE 쿼리 20행 내 미포함 — limit 확대 필요) |
| ScoreboardPlayers LIKE "LCK/2016%" | 성공 (채택) |
| Players (Faker) | 성공, Image 공란 |
| PlayerImages allimages Plan B | 성공 (`Faker2014.jpg`, `Faker_Summer_2016.png` 등) |
| Special:Filepath | 403 — CDN 직접 URL 사용으로 대체 |

### 복합 순위 소스 최종 확정
- **플옵·Worlds·MSI 순위** = TournamentResults (WHERE OverviewPage= 또는 LIKE)
- **정규시즌 순위** = TournamentResults (WHERE OverviewPage=)
- ⚠️ 0-c 참고: playoffs OverviewPage는 "LCK/2016 Season/Summer Playoffs" 형식 — LIKE 패턴이 20행 제한으로 미포함 가능성. 03-results.ts에서 `LIKE "LCK/2016%"` 대신 정확 OverviewPage로 조회해야 함.

### 4리그 시대별 League 값 매핑 (확정)
| 리그 상수 | Tournaments.League 실제 값 |
|---|---|
| LCK | `"LoL Champions Korea"` |
| LPL | `"Tencent LoL Pro League"` |
| EU_LCS | `"Europe League Championship Series"` |
| LEC | `"LoL EMEA Championship"` |
| LCS | `"League of Legends Championship Series"` (2020+), `"North America League Championship Series"` (초기) |
| LTA_NORTH | `"League of Legends Championship of The Americas North"` |

## 구현 완료 스크립트
- `scripts/lib/cargo.ts` — 스로틀 5000ms / 백오프 6회 / 파일 캐시
- `scripts/01-tournaments.ts` — 백그라운드 실행 중 (Worlds 2023 rate-limit, 캐시 62/~75개)
- `scripts/02-rosters.ts` — 01 완료 후 실행 예정
- `scripts/03-results.ts` — 02 완료 후 실행 예정
- `scripts/04-ratings.ts` — 03 완료 후 실행 예정 (PROVISIONAL 모드)
- `scripts/07-build.ts` — 04 완료 후 실행 예정 (PROVISIONAL)
- `scripts/08-anchors.ts` — 07 완료 후 실행 (players.json 의존)
- `scripts/09-montecarlo.ts` — Phase 4 구현 완료 (players.json 의존)
- `scripts/10-photo-whitelist.ts` — 03 완료 후 실행 (Worlds 2013~2024 상위 4팀 화이트리스트, 2025 제외 수정 완료)
- `scripts/11-photo-download.ts` — 호빈 승인 후 수동 실행 (승인 게이트: pipeline-cache/photo-whitelist-approved.txt 생성)
- `src/lib/sim.ts` — Phase 4 구현 완료
- `src/lib/grade.ts` — Phase 4 구현 완료
- `src/lib/useDraftMachine.ts` — Phase 3 상태머신 훅 구현 완료
- `src/app/draft/page.tsx` — Phase 3 draft 페이지 구현 완료
- `src/components/PlayerCard.tsx` — Phase 3 PlayerCard (3 size) 구현 완료
- `src/i18n/` — en/ko 딕셔너리 + LangContext 구현 완료

## 오버나이트 실행 순서
1. 01 완료 → 02-rosters.ts (백그라운드, 수십분 소요)
2. 02 완료 → 03-results.ts
3. 03 완료 → 04-ratings.ts + 10-photo-whitelist.ts (순차)
4. 04 완료 → 07-build.ts (PROVISIONAL 빌드)
5. 07 완료 → 08-anchors.ts + 09-montecarlo.ts
6. 전체 완료 → §0 보고 + awards.csv 초안 생성 → 호빈 검수 대기

## 다음 작업
- **02-rosters.ts 완료 대기** (b4ys0de8e 백그라운드 — LCK 2018 Summer rate-limit 통과 중, cargo 캐시 170/293+개)
- 02 완료 → 03 → 10(whitelist) → 04(PROVISIONAL) → 07(PROVISIONAL) → 08 → 09 자동 연쇄
- 아침: awards.csv 검수 + 앵커 가중치 → 04~07 정식 재실행
- 아침: photo-whitelist.json 검수 → pipeline-cache/photo-whitelist-approved.txt 생성 → 11 수동 실행

## 호빈 게이트 대기
- **awards.csv 검수** (PROVISIONAL 빌드 후)
- **photo-whitelist.json 검수** (10 실행 후) — 승인 후 사진 다운로드
- 앵커 10개 D0 수기 계산 → 레이팅 가중치 확정 (PRD §6.2)

## 호빈 게이트 대기
- **awards.csv 검수** (Phase 1 완료 후)
- 앵커 10개 D0 수기 계산 → 레이팅 가중치 확정 (PRD §6.2)

## 미해결 이슈 / 결정 대기
- 앵커 10개 D0 수기 계산 → 레이팅 가중치 확정 (PRD §6.2) — Phase 1 완료 후 필요
- 네이밍/도메인 (PRD §13 Q1)
- LCS 초기(2013~2018) = `"North America League Championship Series"`, 2019+ = `"League of Legends Championship Series"` (tournaments.json 확정)
- cargo-failures.json: rate-limit 최대 재시도 실패한 대회 목록 (07 완료 후 결손 확인 필요)

## 세션 로그 (최근 5개만 유지)
- 2026-06-11 (세션5): 10-photo-whitelist.ts 2025 제외 수정, 11-photo-download.ts 신규 (승인 게이트 포함). 01-tournaments.ts 재실행 — MSI rate-limit 대기 중
- 2026-06-10 (세션4): Phase 1 스크립트 전체 구현 완료 + sim.ts/grade.ts/09-montecarlo.ts (Phase 4) 커밋. useDraftMachine/PlayerCard/draft page/i18n 구현 완료
- 2026-06-10 (세션3): long→main 개명, CURSOR_GUIDE_1.md 삭제, §5 항목1 SortDate 규칙 교체, WHERE 테스트 결과 반영, Phase 1 착수
- 2026-06-10 (세션2): 호빈 판단(intl-results.csv 기각·복합 순위 소스) 반영, 0-a~0-d WHERE 테스트 완료·커밋
- 2026-06-10 (세션1): CURSOR_GUIDE v2.2 + CLAUDE.md docs 커밋, Phase 0 최종 마무리(T1·S1잔여·SemVal) 완료, discovery.md 갱신
