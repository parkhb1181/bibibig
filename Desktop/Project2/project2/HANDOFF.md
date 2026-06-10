# HANDOFF.md — 세션 인수인계 (Claude Code가 갱신)

> 규칙: Phase 완료·세션 종료 시 Claude Code가 갱신. 새 세션은 이 파일의 "진행 중 / 다음 작업"부터 재개.
> 여기에는 **상태만** 기록한다 — 절차·DoD·수치·스키마는 SSOT 3종이 원문 (복제 금지).

## 현재 상태
- 날짜 / Phase: D0 (2026-06-10) / Phase 0 보완 완료, 최종 마무리 진행 중
- 빌드 상태: scaffold 완료, npm install 완료 (빌드 미실행)
- 브랜치: long

## 완료
- 스캐폴드: Next.js 15 + TypeScript + Tailwind, src/ 구조 (38 파일)
- `public/data/opponents-2026.json` 플레이스홀더 (regular 9팀 / intl 12팀, zod 검증 통과)
- `src/lib/prng.ts` mulberry32 구현
- `scripts/00-discover.ts` — Phase 0 전체 (A~G) + S1~S4 보완 포함
- 커밋: 01d59c5 (D0 scaffold), ed515f0 (S1~S4 보완)
- `pipeline-cache/discovery.md` 생성 (gitignored — 내용은 아래 미해결 이슈 참조)
- 문서: CURSOR_GUIDE.md v2.2(§13~15 신설) · CLAUDE.md 추가 · DESIGN_GUIDE.md · PRD v1.9 (이번 세션 docs: 커밋)

## 진행 중
- Phase 0 최종 마무리: 아래 4개 작업 (레이트리밋 쿨다운 후 새 세션 권장)

## 다음 작업
1. **Worlds·MSI 순위 조사** — Tournaments에서 OverviewPage 3건 확보 → TournamentResults 필드점증 (Team → +Place → +OverviewPage → +Date), WHERE 없이 3초 간격
2. **S1 잔여** — `OverviewPage LIKE "LCS/2020%"` 로 LCS 2020 League 값 · `Year="2025" AND Name LIKE "%LTA%"` 로 LTA North League 값
3. **의미 검증** — 2016 LCK Summer Playoffs `Place=1` 팀명 = "SKT T1" 여부 확인
4. **커밋** — `pipeline:` 접두사로 discovery.md 갱신 내용 커밋

## 호빈 게이트 대기
- **discovery.md 승인** (D0 게이트) — 위 1~4 완료 후 전달 예정

## 미해결 이슈 / 결정 대기
- **CRITICAL**: Standings에 Worlds 데이터 없음 → §4.3 Worlds 레이팅 보너스 계산 불가. TournamentResults 필드점증 결과에 따라: 재채택 OR `pipeline-input/intl-results.csv` 정적 입력 결정 필요 (호빈 판단)
- LCS 2020 League 필드 실값 미확인 (D4 no-WHERE 미실행)
- LTA North 2025 League 필드 실값 미확인 (500-limit 컷오프)
- Special:Filepath → 403 (Phase 2 이미지 전략은 allimages CDN URL 대안으로 대체 예정)
- CURSOR_GUIDE_1.md · CLAUDE_1.md 중복 파일 존재 (삭제 여부 호빈 확인 후 처리)
- 앵커 10개 D0 수기 계산 → 레이팅 가중치 1회 확정 (PRD §6.2)
- 네이밍/도메인 (PRD §13 잔존 Q1)

## 세션 로그 (최근 5개만 유지)
- 2026-06-10: D0 scaffold + Phase 0 (A~G+S1~S4) 완료, docs 파일 교체, Phase 0 최종 마무리 진행 중
