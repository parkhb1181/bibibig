# HANDOFF.md — 세션 인수인계 (Claude Code가 갱신)

> 규칙: Phase 완료·세션 종료 시 Claude Code가 갱신. 새 세션은 이 파일의 "진행 중 / 다음 작업"부터 재개.
> 여기에는 **상태만** 기록한다 — 절차·DoD·수치·스키마는 SSOT 3종이 원문 (복제 금지).

## 현재 상태
- 날짜 / Phase: D0 (2026-06-10) / 0-a~0-d WHERE 테스트 진행 중
- 빌드 상태: scaffold 완료, npm install 완료 (빌드 미실행)
- 브랜치: long

## 완료
- 스캐폴드: Next.js 15 + TypeScript + Tailwind, src/ 구조
- `public/data/opponents-2026.json` 플레이스홀더 (regular 9팀 / intl 12팀)
- `src/lib/prng.ts` mulberry32 구현
- `scripts/00-discover.ts` Phase 0 전체 (A~G + S1~S4) 실행 완료
- `scripts/00-final.ts` Phase 0 최종 마무리 (T1·S1잔여·SemVal) 실행 완료
- `pipeline-cache/discovery.md` 갱신 완료 (gitignored)
- 커밋: 01d59c5 (D0 scaffold), ed515f0 (S1~S4), 9815923 (docs CURSOR_GUIDE v2.2 + CLAUDE.md), 5acc7dc (T1/S1잔여/SemVal)

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
| TournamentResults no-WHERE (Team,Place,OverviewPage,Date) | 성공 (OGN Club Masters 초기 노이즈 확인) |
| Standings LCK 2016 Summer Playoffs | **0행 — 미커버** |
| ScoreboardPlayers LIKE "LCK/2016%" | 성공 (채택) |
| Players (Faker) | 성공, Image 공란 |
| PlayerImages allimages Plan B | 성공 (`Faker2014.jpg`, `Faker_Summer_2016.png` 등) |
| Special:Filepath | 403 — CDN 직접 URL 사용으로 대체 |

### 호빈 판단 (2026-06-10, 새 세션 지시)
- **판단1**: intl-results.csv 정적 입력 전환 기각. TournamentResults WHERE 점증 테스트 먼저.
- **판단2**: 순위 소스 복합 구조 확정 — 플옵·Worlds·MSI = TournamentResults, 정규시즌 순위 = 0-d 결과로 확정.

## 진행 중
- `scripts/00-where-test.ts` 작성 중 (0-a~0-d TournamentResults WHERE 테스트)

## 다음 작업
1. 0-a~0-d 테스트 실행 + discovery.md 갱신 + pipeline: 커밋
2. **판정 규칙**:
   - 0-b 성공 → 순위 소스 확정 완료, Phase 1 착수
   - 0-b 실패·0-a 성공 → Date 범위 청크 + 로컬 필터 전략 기록 후 Phase 1 착수
   - 둘 다 실패 → 멈추고 보고
3. Phase 1 완료 시 §0 보고 포맷 출력 + HANDOFF.md 갱신. awards.csv 초안은 검수 대기.

## 호빈 게이트 대기
- **0-a~0-d 테스트 결과 확인** (자동 진행 조건: 0-b 성공)
- **awards.csv 검수** (Phase 1 완료 후)
- CURSOR_GUIDE_1.md · CLAUDE_1.md 중복 파일 삭제 여부

## 미해결 이슈 / 결정 대기
- 앵커 10개 D0 수기 계산 → 레이팅 가중치 확정 (PRD §6.2) — Phase 1 완료 후 필요
- 네이밍/도메인 (PRD §13 Q1)
- PlayerImages SortDate 공란 → Tournament 연도 파싱 정렬 규칙 (호빈 확인 대기)

## 세션 로그 (최근 5개만 유지)
- 2026-06-10 (세션2): 호빈 판단(intl-results.csv 기각·복합 순위 소스) 반영, HANDOFF.md 갱신, 0-a~0-d 테스트 착수
- 2026-06-10 (세션1): CURSOR_GUIDE v2.2 + CLAUDE.md docs 커밋, Phase 0 최종 마무리(T1·S1잔여·SemVal) 완료, discovery.md 갱신
