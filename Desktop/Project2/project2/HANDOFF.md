# HANDOFF.md — 세션 인수인계 (Claude Code가 갱신)

> 규칙: Phase 완료·세션 종료 시 Claude Code가 갱신. 새 세션은 이 파일의 "진행 중 / 다음 작업"부터 재개.
> 여기에는 **상태만** 기록한다 — 절차·DoD·수치·스키마는 SSOT 3종이 원문 (복제 금지).

## 현재 상태
- 날짜 / Phase: D2 (2026-06-12) / Phase 3 진행 중
- 브랜치: main (최신 커밋: 70bef93)
- 빌드 상태: Next.js build ✓ (8 페이지 정상)
- **복귀 후 재개 시작점**: Vercel 배포 확인 → 브라우저 UI 검증(모바일/PC) → 호빈 피드백 기반 후속 조정

## 완료 (최신)
- **UX 대규모 개선 9종 (70bef93)**: 영문화·레이아웃·카드·시뮬 연출 전면 개편
  1. i18n 제거 — 영문 단일화 (LangProvider/ko.ts 제거, useLang → en passthrough)
  2. 슬롯 1줄 수평(flex-nowrap) + 100dvh safe-area + PC 결과 grid-cols-5
  3. 스크롤바 숨김(no-scrollbar) + Reroll 버튼 Primary CTA + 서브텍스트 명도 개선
  4. 트로피→배경글로우: MSI 골드 그라디언트+반짝이 / Worlds 파란 배경+골드보더
  5. crown→FINALS MVP 배지 (crown.png 오버레이 제거)
  6. 뱃지 라벨 `ALL-PRO`→`1st`
  7. 시즌 영문화: Spring/Summer + QF/SF/Finals 라운드 레이블
  8. 시뮬 연출: 1000ms 간격, 마지막 상대 표시
  9. 경기 결과 시각화: 세트별 원(●●○○●) + DNQ 회색원
- **상대 풀 3분리 + S=20 확정 (70bef93)**: regular/msi/worlds 분리, Worlds 통과율 65.5%
- **PlayerCard photo fix (9d1eaae)**: env var 방식 폐기 → player.photo 직접 사용. origin/main push 완료
- **players.json photo 보존 (e7b20e8)**: 07-build.ts 재실행 시 R2 URL 덮어쓰기 방지 로직 추가
- **리그 계수 적용 (2637599)**: LEC×0.95 / LCS×0.85, 국내 플옵 가점 한정 (CURSOR_GUIDE §9-⑤)
- **Phase 2 실행 완료 (9f6fa15)**: 05-images.ts 852건 다운로드 + 871건 webp 변환(실패 0) → 06-upload-r2.ts R2 871건 업로드 100% → players.json photo 871건 갱신
- **stats_agg KDA 차등 (78ce42a)**: 04-ratings role×year z-score ±3 (2013~2020), 서브 -1 (전 시대). 2015 SKT 99/99/98/98/96, 2024 T1 93/89×4, 시대 평균 79.6/79.7(형평 확인)
- **Phase 1 재빌드 완료 (15bbea9)**: LEC/LCS 국내 플옵 결과 포함, awards.csv playerId 28건 수정, Xiaohu 2022 FMVP 활성화, 07-build.ts LEC/LCS 필터 수정
  - players.json 2223건 / teams.json 445건 / OVR 75: 0명 (전원 플옵 컷 이상)
  - Bjergsen 81→89, G2 2019 83-87→93-97 (LEC domestic 반영 효과)
  - stats(04b): v1.1 포기 결정 — stats_agg 캐시 37개 미완성 상태로 보존 (v1.1 재개용)

## 완료 (이전)
- 스캐폴드: Next.js 15 + TypeScript + Tailwind, src/ 구조
- `public/data/opponents-2026.json` 플레이스홀더 (regular 9팀 / intl 12팀)
- `src/lib/prng.ts` mulberry32 구현
- Phase 0 전체 (A~G + S1~S4 + WHERE 테스트) 완료
- Phase 1 스크립트 전체 구현 완료 (01~04, 07~10, lib/cargo.ts)
- sim.ts / grade.ts / useDraftMachine / PlayerCard / draft page / i18n 구현 완료
- **awards.csv v0.3** 확정 (WORLDS_MVP 11건·SEASON_MVP·FINALS_MVP·ALLPRO 교정 완료)
- **01-tournaments.ts 버그 수정** (Worlds 2017+ OverviewPage + LCK 2013~2015 League명)
- **cargo.ts 무한 재시도** (429/5xx/네트워크 오류 → 60s 고정 무한 대기)
- **03-results.ts** Worlds /Main Event 버그 수정 (trOverviewPage), LEC/LCS 국내 스킵
- **07-build.ts** LEC/LCS PlayerSeason v1 제외
- **GAME_SPEC §1-2-4-7 구현 완료** (커밋 16227be)
- **더미 데이터** 생성 (5팀 LCK — SKT16, T123, GenG24, KT18, DRX22)
- **6가지 개선 완료** (이전 세션 전달 목록):
  1. 카드 등급 색 제거 — 전 선수 동일 디자인
  2. 다전제 변경 — 정규시즌 Bo3 (CURSOR_GUIDE §7.1 수정 필요: Bo1→Bo3)
  3. html2canvas 폐기 결정 (이미지 공유 = OG만)
  4. 경기 가독성 — 섹션별 그룹 (스프링/MSI/서머/Worlds)
  5. RevealScreen 1단계씩 표시
  6. 홈 페이지 디자인 완성 (GRAND SLAM 타이포)
- **OG 이미지 강화 완료** (67ffd0a):
  - `/api/og/route.tsx`: 1200×630 ImageResponse — 등급/트로피/OVR/5인 스트립
  - `/r/page.tsx`: generateMetadata + 서버 렌더 결과 페이지 (URLSearchParams 직렬화)

### Phase 0 검증 결과 요약
| 항목 | 결과 |
|---|---|
| LCK League 값 | 2013~2015: `"LoL The Champions"`, 2016+: `"LoL Champions Korea"` |
| LPL League 값 | `"Tencent LoL Pro League"` |
| LEC League 값 | `"LoL EMEA Championship"` |
| LCS (2025) League 값 | `"League of Legends Championship of The Americas North"` |
| TournamentResults | **채택** |

## 진행 중
없음.

## 완료 (세션16 — 2026-06-12)
- **전체 영문화 완료 (f99d88b)**: src/ 전체 한글 0건 — 주석/i18n 전부 영어로 전환
- **Bug 2종 수정 (9de2cd6)**: 하단 흰 여백 (overscroll-behavior:none + 100dvh) + 카드 스크롤바 (w-36→w-32, max-w-2xl)
- **Caps/BrokenBlade 2024 OVR 95 확인**: players.json 실반영 ✓ (04-ratings OVR_OVERRIDES, ddde98d)
- **Longzhu 2017 +4 확인**: players.json 실반영 ✓ (awards.csv + players.json Khan88/Cuzz85/Bdd90/PraY84/GorillA84)

## 다음 작업

### ① Canyon/Chovy 앵커 조정 (호빈 결정 후)
선택지 3가지 → 호빈 결정 필요:
1. awards.csv EDITORIAL 마이너스 추가 (Canyon -3, Chovy -5 전후) → 목표 96 이하 진입
2. PRD §6.2 앵커 목표값 상향 (96~99로 수용) → "최고 선수는 99 가능" 설계
3. WORLDS_MVP/SEASON_MVP 가점 자체 하향 → 전체 분포 재조정

### ② opponents-2026.json 실값 교체 (D3 게이트)
현재 플레이스홀더 유지 — 호빈이 실명·레이팅 확정 후 교체

### ③ 프론트 잔여 작업
- DESIGN_GUIDE v1.0 승격 후 CSS 변수/토큰 적용
- PlayerCard: WORLDS 프레임 시머 애니메이션, crown 오버레이 (에셋 수령 후)
- lab/page.tsx: 카드 디자인 랩 구현
- 09-montecarlo.ts: 실데이터 교체 후 밸런스 검증

### ③ 프론트 잔여 작업 (GAME_SPEC 기반)
- DESIGN_GUIDE v1.0 승격 후 CSS 변수/토큰 적용 (현재 임시 하드코딩)
- PlayerCard: WORLDS 프레임 시머 애니메이션, crown 오버레이 (에셋 수령 후)
- lab/page.tsx: 카드 디자인 랩 구현
- 09-montecarlo.ts: 더미→실데이터 교체 후 밸런스 검증

## 호빈 게이트 대기
- **리그 계수 적용 여부**: LCS 과대평가 확인(Doublelift 2019=94 > Faker 2019=90). 제안: 국내 플옵 가산에 계수 LCK/LPL×1.0, LEC×0.9, LCS×0.85 적용. 승인 시 즉시 구현 가능 (§9 外 변경이므로 명시 승인 필요)
- **Canyon/Chovy 앵커 조정 방향 결정** — 현재 Canyon 97(목표 96), Chovy 99(목표 96). 위 3가지 선택지 중 결정 필요
- **Vercel NEXT_PUBLIC_R2_PUBLIC_BASE_URL 설정 확인** — 미설정 시 사진 미표시
- **opponents-2026.json 실값 교체** (D3 — 현재 플레이스홀더)
- **DESIGN_GUIDE v1.0 승격** (D4 전) — CSS 토큰 확정 후 프론트 적용

## 미해결 이슈
- 앵커 가중치 미확정 (08 결과 후 PRD §6.2 기준 튜닝)
- LEC/LCS v1.1 (파이프라인 국내 결과 수집 후 추가)
- 네이밍/도메인 (PRD §13 Q1)

## 세션 로그 (최근 5개만 유지)
- 2026-06-12 (세션15): UX 대규모 개선 9종 + 상대풀 3분리 커밋(70bef93). 빌드 ✓. 브라우저 검증 대기.
- 2026-06-12 (세션14): awards.csv playerId 28건 수정+Xiaohu 활성화+LEC/LCS 국내결과+07-build 필터 수정. players.json 2223건. Bjergsen 89, G2 2019 93-97.
- 2026-06-12 (세션13): 3개 버그 수정 완료 (78384d5). Worlds frame 정확(13팀·연도), KT2015 5명(dedup), G2/FNC/C9/TL 포함 확인. players.json 1593건. ④사진은 Phase2 미구현으로 null 유지.
- 2026-06-12 (세션12): 5가지 묶음 적용 완료 (18896bd). OVR 압축 78~99, 99→2명, 카드 풀 2999→1714명, Faker 닉네임/Faker2013 OVR 94 복구. Canyon 97/Chovy 99 구조적 한계 보고.
- 2026-06-12 (세션11): OG 이미지 강화 (/api/og) + /r generateMetadata 완료 (67ffd0a). 6가지 UI 개선 완료. build 통과.
- 2026-06-12 (세션10): GAME_SPEC v1 구현 — 자동스핀·fullReroll·S=20·타임라인. 더미 5팀 생성.
- 2026-06-11 (세션9): Worlds 2017~2025 TournamentResults 버그 수정(dcf50be). 통합 재실행 계획 수립.
- 2026-06-11 (세션8): LCK 2013~2015 League명 실값 확인. 01-tournaments.ts 픽스(b7be083).
- 2026-06-11 (세션7): awards.csv v0.3 확정, 01-tournaments.ts Worlds 2017+ 버그 수정.
