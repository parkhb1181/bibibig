# HANDOFF.md — 세션 인수인계 (Claude Code가 갱신)

> 규칙: Phase 완료·세션 종료 시 Claude Code가 갱신. 새 세션은 이 파일의 "진행 중 / 다음 작업"부터 재개.
> 여기에는 **상태만** 기록한다 — 절차·DoD·수치·스키마는 SSOT 3종이 원문 (복제 금지).

## 현재 상태
- 날짜 / Phase: D1 (2026-06-10) / Phase 1 착수 (01~04, 07 구현 중)
- 빌드 상태: scaffold 완료, npm install 완료 (빌드 미실행)
- 브랜치: main (long → main 개명 완료)

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

## 진행 중
- Phase 1 착수: scripts/lib/cargo.ts + 01~04, 07 구현 중

## 다음 작업
1. `scripts/lib/cargo.ts` 구현 (쿼리 분할 클라이언트, §4.1)
2. `scripts/01-tournaments.ts` — 4리그 × 2013~2025 대회 목록 수집
3. `scripts/02-rosters.ts` — ScoreboardPlayers 기반 로스터 도출 (§3 규칙)
4. `scripts/03-results.ts` — TournamentResults 순위 수집 (WHERE OverviewPage 정확 일치 우선)
5. `scripts/04-ratings.ts` — 레이팅 산출 + awards.csv 병합
6. `scripts/07-build.ts` — zod 검증 + JSON 빌드
7. Phase 1 완료 후: §0 보고 포맷 출력, awards.csv 초안 생성 → 검수 대기

## 호빈 게이트 대기
- **awards.csv 검수** (Phase 1 완료 후)
- 앵커 10개 D0 수기 계산 → 레이팅 가중치 확정 (PRD §6.2)

## 미해결 이슈 / 결정 대기
- 앵커 10개 D0 수기 계산 → 레이팅 가중치 확정 (PRD §6.2) — Phase 1 완료 후 필요
- 네이밍/도메인 (PRD §13 Q1)
- LCS 초기(2013~2019) League 값 = `"North America League Championship Series"` vs `"League of Legends Championship Series"` — 01-tournaments.ts 실행 시 확정

## 세션 로그 (최근 5개만 유지)
- 2026-06-10 (세션3): long→main 개명, CURSOR_GUIDE_1.md 삭제, §5 항목1 SortDate 규칙 교체, WHERE 테스트 결과 반영, Phase 1 착수
- 2026-06-10 (세션2): 호빈 판단(intl-results.csv 기각·복합 순위 소스) 반영, 0-a~0-d WHERE 테스트 완료·커밋
- 2026-06-10 (세션1): CURSOR_GUIDE v2.2 + CLAUDE.md docs 커밋, Phase 0 최종 마무리(T1·S1잔여·SemVal) 완료, discovery.md 갱신
