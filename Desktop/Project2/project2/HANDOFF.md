# HANDOFF.md — 세션 인수인계 (Claude Code가 갱신)

> 규칙: Phase 완료·세션 종료 시 Claude Code가 갱신. 새 세션은 이 파일의 "진행 중 / 다음 작업"부터 재개.
> 여기에는 **상태만** 기록한다 — 절차·DoD·수치·스키마는 SSOT 3종이 원문 (복제 금지).

## 현재 상태
- 날짜 / Phase: D0 (2026-06-10) / Phase 0 최종 마무리 완료, discovery.md 승인 대기
- 빌드 상태: scaffold 완료, npm install 완료 (빌드 미실행)
- 브랜치: long

## 완료
- 스캐폴드: Next.js 15 + TypeScript + Tailwind, src/ 구조
- `public/data/opponents-2026.json` 플레이스홀더 (regular 9팀 / intl 12팀)
- `src/lib/prng.ts` mulberry32 구현
- `scripts/00-discover.ts` Phase 0 전체 (A~G + S1~S4) 실행 완료
- `scripts/00-final.ts` Phase 0 최종 마무리 (T1·S1잔여·SemVal) 실행 완료
- `pipeline-cache/discovery.md` 갱신 완료 (gitignored)
- 커밋: 01d59c5 (D0 scaffold), ed515f0 (S1~S4), 9815923 (docs CURSOR_GUIDE v2.2 + CLAUDE.md)

### S1 — 4리그 League 필드 실값 확정
| 리그 | 시대 | League 실값 |
|---|---|---|
| LCK | 2016/2025 | `"LoL Champions Korea"` |
| LPL | 2016/2025 | `"Tencent LoL Pro League"` |
| EU LCS | 2016 | `"Europe League Championship Series"` |
| LEC | 2025 | `"LoL EMEA Championship"` |
| LCS (NA) | 2016 | `"North America League Championship Series"` |
| LCS | 2020 | `"League of Legends Championship Series"` |
| LTA North | 2025 | `"League of Legends Championship of The Americas North"` |
| Worlds | 2016 | `"World Championship"`, OverviewPage: `"2016 Season World Championship"` |
| MSI | 2016 | `"Mid-Season Invitational"`, OverviewPage: `"2016 Mid-Season Invitational"` |

## 진행 중
- (없음)

## 다음 작업
1. **TournamentResults WHERE 테스트** (새 세션, 레이트리밋 쿨다운): `WHERE OverviewPage="2016 Season World Championship"` 시도 → 성공 시 Worlds 순위 채택; 실패(MWException) 시 `pipeline-input/intl-results.csv` 정적 입력으로 전환 (호빈 판단)
2. **SemVal 보완**: TournamentResults로 LCK 2016 Summer Playoffs Place=1 = SKT T1 검증 (Standings 불가 확인)
3. **discovery.md 호빈 승인** → Phase 1 착수

## 호빈 게이트 대기
- **discovery.md 승인** (D0 게이트)
- **TournamentResults WHERE 가능 여부** 판단 (아래 미해결 이슈 참조)

## 미해결 이슈 / 결정 대기
- **CRITICAL**: TournamentResults no-WHERE는 작동하지만 Team="", Place="'" 등 데이터 품질 이슈 확인 필요. WHERE 사용 가능 여부 미확인 (이전 run은 MWException, 원인 불명).
- **CRITICAL**: Standings에 LCK Season Playoffs + Worlds 데이터 없음 → §4.3 레이팅 공식 집행 방법 결정 필요 (호빈).
  - 옵션 A: TournamentResults WHERE = 테스트 성공 시 채택
  - 옵션 B: `pipeline-input/intl-results.csv` 정적 입력 (Worlds/MSI 역대 순위 수기 입력)
- Special:Filepath → 403 (Phase 2 이미지는 allimages CDN URL로 대체 예정)
- CURSOR_GUIDE_1.md · CLAUDE_1.md 중복 파일 존재 (삭제 여부 호빈 확인)
- 앵커 10개 D0 수기 계산 → 레이팅 가중치 1회 확정 (PRD §6.2)
- 네이밍/도메인 (PRD §13 잔존 Q1)

## 세션 로그 (최근 5개만 유지)
- 2026-06-10: CURSOR_GUIDE v2.2 + CLAUDE.md docs 커밋, Phase 0 최종 마무리(T1·S1잔여·SemVal) 완료, discovery.md 갱신
