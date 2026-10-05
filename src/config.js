// =====================================================================
//  GAME_CONFIG — 게임 밸런스(경제 규칙·사회점수)는 전부 여기서만 수정합니다.
//  숫자만 바꾸고 서버를 다시 켜면(또는 어드민에서 '전체 초기화') 전체 게임에 반영됩니다.
//  ※ 이 파일은 서버에서만 읽습니다. 학생 브라우저로는 전송되지 않습니다.
// =====================================================================

export const GAME_CONFIG = {
  // 모든 기업의 시작 자금. 이윤 = 현재 가진 돈 - STARTING_CASH
  STARTING_CASH: 1_000_000,

  // ── ROUND 1 · 가격 ───────────────────────────────────────────────
  PRICE_OPTIONS: [5000, 10000, 15000, 20000],

  // 가격별 '한 라운드' 기본 판매량(개). 매 라운드 끝날 때마다 판매가 일어납니다.
  BASE_SALES_BY_PRICE: {
    5000: 80,
    10000: 50,
    15000: 35,
    20000: 25,
  },

  // 다른 4개 기업의 평균 가격과 비교한 상대가격 보정
  //   보정 = SENSITIVITY × (다른 기업 평균가 - 우리 가격) / 다른 기업 평균가
  //   → -MAX ~ +MAX 범위로 제한 (0.10 = ±10%)
  RELATIVE_PRICE_EFFECT: {
    SENSITIVITY: 0.25,
    MAX: 0.10,
  },

  // 기업별·라운드별 시장 미세변동 폭 (0.03 = ±3%). 세션 시작 시 한 번 정해져 고정됩니다.
  // 너무 키우면 순위가 운으로 뒤집히니 0.05 이하를 권장합니다.
  MARKET_VARIANCE: 0.03,

  // ── ROUND 2 · 광고 ───────────────────────────────────────────────
  AD_COSTS: {
    celebrity: 300_000, // 유명인 광고
    exaggerated: 80_000, // 과장 광고
    honest: 160_000, // 정직 광고
  },
  // 판매량 배수. ROUND 2부터 이후 모든 판매 라운드(2·3·4)에 계속 적용됩니다.
  AD_MULTIPLIERS: {
    celebrity: 1.35,
    exaggerated: 1.30,
    honest: 1.15,
  },

  // ── ROUND 3 · 생산 (판매량에는 영향 없음, 비용만 차감) ─────────────
  PRODUCTION_COSTS: {
    eco: 300_000, // 친환경 생산
    normal: 150_000, // 일반 생산
    cheap: 50_000, // 비용 절감 생산
  },

  // ── ROUND 4 · 공동 제안(담합) ─────────────────────────────────────
  // 참여 기업은 이번 라운드 판매가격이 COLLUSION_PRICE 로 바뀝니다. 불참 기업은 원래 가격 유지.
  COLLUSION_PRICE: 30_000,

  // 참여 기업 수별 효과
  //   MEMBER_BASE_SALES     : 참여 기업 1곳의 기본 판매량(개) — 여기에 광고 배수·시장변동이 곱해짐
  //   NON_MEMBER_MULTIPLIER : 불참 기업의 판매량 배수 — 평소 판매량(상대가격 보정 포함)에 곱해짐
  COLLUSION_EFFECTS: {
    0: { MEMBER_BASE_SALES: 0, NON_MEMBER_MULTIPLIER: 1.0 },
    1: { MEMBER_BASE_SALES: 8, NON_MEMBER_MULTIPLIER: 1.0 }, // 사실상 무산: 혼자 비싸면 손해
    2: { MEMBER_BASE_SALES: 13, NON_MEMBER_MULTIPLIER: 1.1 }, // 아직 저가 기업이 많아 참여 기업이 불리
    3: { MEMBER_BASE_SALES: 26, NON_MEMBER_MULTIPLIER: 1.2 }, // 과반 참여: 참여 기업 이익 커지기 시작
    4: { MEMBER_BASE_SALES: 34, NON_MEMBER_MULTIPLIER: 1.45 }, // 참여 기업 큰 이익, 1개 불참 기업도 판매 급증
    5: { MEMBER_BASE_SALES: 42, NON_MEMBER_MULTIPLIER: 1.0 }, // 모두 참여: 모두 단기 이윤 크게 증가
  },

  // ── 숨은 돌멩민국 사회점수 (하나만 존재, 음수 가능) ─────────────────
  SOCIAL_SCORE_START: 100,
  SOCIAL_SCORE_DELTAS: {
    AD: { celebrity: 0, exaggerated: -20, honest: 0 }, // 소비자 보호 (기업 1개당)
    PRODUCTION: { eco: 0, normal: -10, cheap: -20 }, // 환경 (기업 1개당)
    COLLUSION_BY_COUNT: { 0: 0, 1: 0, 2: -10, 3: -20, 4: -30, 5: -30 }, // 공정 경쟁 (참여 기업 수 기준, 전체 1회)
  },

  // ── 교사가 미제출 모둠을 두고 강제 진행했을 때 자동 적용되는 선택 ─────
  //   2라운드 'none' = 광고 안 함(비용 0, 판매효과 없음)
  DEFAULT_IF_MISSING: {
    1: 10000,
    2: 'none',
    3: 'normal',
    4: 'no',
  },

  // ── 입력 제한 ────────────────────────────────────────────────────
  REASON_MIN_LENGTH: 2,
  REASON_MAX_LENGTH: 120,
};

// 서버 운영 설정 (밸런스와 무관)
export const SERVER_CONFIG = {
  PORT: Number(process.env.PORT) || 3000,
  // 교사용 PIN — 환경변수 ADMIN_PIN 으로 바꾸거나 여기서 수정하세요.
  ADMIN_PIN: process.env.ADMIN_PIN || '2580',
  DATA_FILE: process.env.DATA_FILE || 'data/state.json',
  // 사회 영향 영상. 이 경로에 파일을 넣기만 하면 됩니다. 없으면 대체 슬라이드가 나옵니다.
  VIDEO_FILE: 'public/videos/social-impact.mp4',
  VIDEO_URL: '/videos/social-impact.mp4',
  HEARTBEAT_MS: 15_000,
};
