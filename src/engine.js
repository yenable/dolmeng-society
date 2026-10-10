// 게임 상태 · 진행 · 시장 계산 · 역할별 화면 데이터 (서버 전용)
import crypto from 'node:crypto';
import { GAME_CONFIG as C } from './config.js';
import {
  COMPANIES, TEAM_IDS, ROUNDS, REFLECTION, CLOSING_TEXT, CATEGORY_LABELS, SAMPLE_REASONS, SCORE_QUESTIONS, LESSON, CONCEPT,
  optionOf, optionLabel, companyName,
} from './content.js';
import { buildNews } from './news.js';
import { josa, withJosa, joinNamesJosa } from './josa.js';

export class GameError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

// ── 진행 단계 (TV 화면 = PPT 상태 머신) ──────────────────────────────
// 도입 슬라이드(kind: 'lesson') → 기업 선택(INTRO) → ROUND1 … 순서. 새 세션은 LESSON_WAIT(수업 대기)에서 시작.
// 수업을 시작하면 첫 본문은 돌멩민국 상황 제시 → 자격 TEST(Q1~Q3·통과) → 슬랑이 기업 5곳 → …
export const LESSON_STEPS = [
  { id: 'LESSON_WAIT', slide: 'wait', label: '수업 대기 화면', enterLabel: '수업 대기 화면으로' },
  { id: 'LESSON_COUNTRY', slide: 'country', label: '돌멩민국 상황 제시', enterLabel: '돌멩민국 상황 제시' },
  { id: 'LESSON_TEST', slide: 'testStart', label: '기업 경영자 자격 TEST 시작', enterLabel: '자격 TEST 시작' },
  { id: 'LESSON_Q1', slide: 'q1', label: '자격 TEST Q1 · 이윤', enterLabel: 'Q1 이윤' },
  { id: 'LESSON_Q2', slide: 'q2', label: '자격 TEST Q2 · 기업의 역할', enterLabel: 'Q2 기업의 역할' },
  { id: 'LESSON_Q3', slide: 'q3', label: '자격 TEST Q3 · 가계의 역할', enterLabel: 'Q3 가계의 역할' },
  { id: 'LESSON_PASS', slide: 'pass', label: '자격 TEST 통과', enterLabel: '자격 TEST 통과' },
  { id: 'LESSON_COMPANIES', slide: 'companies', label: '슬랑이 기업 5곳 소개', enterLabel: '슬랑이 기업 5곳 소개' },
  { id: 'LESSON_MISSION', slide: 'mission', label: '오늘의 미션', enterLabel: '오늘의 미션' },
  { id: 'LESSON_TOPIC', slide: 'topic', label: '오늘의 배움 목표', enterLabel: '오늘의 배움 목표' },
  { id: 'LESSON_ACTIVITIES', slide: 'activities', label: '오늘의 활동', enterLabel: '오늘의 활동' },
  { id: 'LESSON_ACT1', slide: 'act1Title', label: '활동 1 타이틀', enterLabel: '활동 1 타이틀' },
  { id: 'LESSON_ACT1_ASK', slide: 'act1Ask', label: '활동 1 도입 발문', enterLabel: '활동 1 도입 발문' },
  { id: 'LESSON_HOWTO', slide: 'howto', label: '시뮬레이션 진행 방법', enterLabel: '시뮬레이션 진행 방법' },
].map((x) => ({ ...x, kind: 'lesson', label: `도입 · ${x.label}`, quiz: LESSON[x.slide].type ?? null }));
export const FIRST_STEP_ID = LESSON_STEPS[0].id;

// 개념 정리·발문 슬라이드 (kind: 'concept'): 도입 슬라이드와 같은 PPT 화면. 학생 화면은 'TV 를 보세요' 그대로.
const concept = (id, slide, group, label, enterLabel = label) => ({ id, slide, group, kind: 'concept', label: `${group} · ${label}`, enterLabel });

export const STEPS = (() => {
  const s = [...LESSON_STEPS, { id: 'INTRO', kind: 'intro', label: '기업 선택 · 접속 확인', enterLabel: '기업 선택 화면으로' }];
  for (let r = 1; r <= 4; r++) {
    s.push({ id: `ROUND${r}_SCENE`, kind: 'scene', round: r, label: `${r}라운드 · 상황 제시`, enterLabel: `${r}라운드 상황 보여주기` });
    s.push({ id: `ROUND${r}_MEETING`, kind: 'meeting', round: r, label: `${r}라운드 · 기업 회의 (선택 받는 중)`, enterLabel: '기업 회의 시작 (학생 선택 열기)' });
    s.push({ id: `ROUND${r}_RESPONSES`, kind: 'responses', round: r, label: `${r}라운드 · 선택과 이유 공개`, enterLabel: '선택과 이유 공개' });
    s.push({ id: `ROUND${r}_RESULT`, kind: 'result', round: r, label: `${r}라운드 · 시장 결과`, enterLabel: '시장 결과 계산 · 공개' });
    if (r < 4) s.push({ id: `ROUND${r}_RANK`, kind: 'rank', round: r, label: `${r}라운드 · 이윤 순위`, enterLabel: '이윤 순위 보기' });
  }
  s.push(
    { id: 'FINAL_PROFIT', kind: 'final', label: '최종 이윤 순위', enterLabel: '최종 이윤 순위 발표' },
    concept('ACT1_FREEDOM', 'freedom', '활동 1 정리', '기업의 자유', '기업의 자유 정리'),
    concept('ACT2_ASK', 'act2Ask', '활동 2', '도입 발문 (가장 잘 운영한 기업은?)', '활동 2 도입 발문'),
    { id: 'BLACKOUT', kind: 'blackout', dark: true, label: '사회적 영향 · 하지만…', enterLabel: '사회적 영향 공개 시작' },
    { id: 'NEWS_CONSUMER', kind: 'news', news: 'consumer', dark: true, label: '뉴스 · 소비자 보호', enterLabel: '소비자 뉴스' },
    { id: 'NEWS_ENVIRONMENT', kind: 'news', news: 'environment', dark: true, label: '뉴스 · 환경', enterLabel: '환경 뉴스' },
    { id: 'NEWS_FAIRNESS', kind: 'news', news: 'fairness', dark: true, label: '뉴스 · 공정 경쟁', enterLabel: '공정 경쟁 뉴스' },
    { id: 'SOCIAL_PAPER', kind: 'paper', dark: true, label: '사회면 · 오늘의 주요 소식', enterLabel: '사회면 주요 소식' },
    { id: 'SOCIAL_SCORE_REVEAL', kind: 'score', dark: true, label: '돌멩민국 사회점수 공개', enterLabel: '사회점수 공개' },
    concept('CSR_ASK', 'csrAsk', '사회적 책임', '도입 발문 (함께 생각해야 할 것은?)', '사회적 책임 도입 발문'),
    concept('CSR_CONCEPT', 'csr', '사회적 책임', '개념 정리', '기업의 사회적 책임 개념 정리'),
    concept('CSR_SUMMARY', 'freedomCsr', '사회적 책임', '기업의 자유 + 사회적 책임', '기업의 자유 + 사회적 책임 정리'),
    { id: 'REFLECTION', kind: 'reflection', label: '정리 · 우리 기업의 선택 다시 생각하기', enterLabel: '우리 기업의 선택 다시 생각하기 (학생 화면 열기)' },
    { id: 'REFLECTION_RESPONSES', kind: 'reflectionResponses', label: '정리 · 바꾼 선택과 이유 공개', enterLabel: '바꾼 선택과 이유 공개' },
    { id: 'CLOSING', kind: 'closing', dark: true, label: '마무리 문장', enterLabel: '마무리 문장' },
  );
  return s.map((x, index) => ({ ...x, index }));
})();
const STEP_BY_ID = Object.fromEntries(STEPS.map((s) => [s.id, s]));
const stepPublic = (st) => ({
  id: st.id, kind: st.kind, round: st.round ?? null, label: st.label, news: st.news ?? null, dark: !!st.dark, index: st.index,
  slide: st.slide ?? null, quiz: st.quiz ?? null, group: st.group ?? null,
});

const DECISION_ROUND = { price: 1, ad: 2, production: 3, collusion: 4 };
const DECISION_OBJECT = { 1: '가격을', 2: '광고 방법을', 3: '생산 방법을', 4: '공동 제안 참여 여부를' };
const CATEGORY_ORDER = ['consumer', 'environment', 'fairness'];
const TOTAL = TEAM_IDS.length;
const STATE_VERSION = 2;

// 학생 재접속 토큰: 브라우저에는 원문, 서버 상태·DB에는 해시만 저장
export const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

// ── 유틸 ────────────────────────────────────────────────────────────
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const cleanText = (x) => String(x ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const colorOf = (id) => COMPANIES.find((c) => c.id === id)?.color;

export function relativePriceFactor(price, otherPrices) {
  if (!otherPrices.length) return 1;
  const avg = otherPrices.reduce((a, b) => a + b, 0) / otherPrices.length;
  if (!avg) return 1;
  const { SENSITIVITY, MAX } = C.RELATIVE_PRICE_EFFECT;
  return 1 + clamp((SENSITIVITY * (avg - price)) / avg, -MAX, MAX);
}

export function createState(keepTeams = null) {
  const seed = crypto.randomInt(1, 2 ** 31 - 1);
  const rand = mulberry32(seed);
  const variance = {};
  for (const id of TEAM_IDS) {
    variance[id] = {};
    for (let r = 1; r <= 4; r++) variance[id][r] = Math.round((1 + (rand() * 2 - 1) * C.MARKET_VARIANCE) * 10000) / 10000;
  }
  const teams = {};
  for (const { id } of COMPANIES) {
    const prev = keepTeams?.[id];
    teams[id] = {
      id,
      tokenHash: prev?.tokenHash ?? null,
      virtual: prev?.virtual ?? false,
      claimedAt: prev?.claimedAt ?? null,
      cash: C.STARTING_CASH,
      revenueTotal: 0,
      unitsTotal: 0,
      choices: { price: null, ad: null, production: null, collusion: null },
    };
  }
  return {
    version: STATE_VERSION,
    sessionId: crypto.randomUUID(),
    createdAt: Date.now(),
    rev: 1,
    seed,
    variance,
    stepId: FIRST_STEP_ID,
    revealIndex: 0,
    quizHints: {}, // 도입 퀴즈(Q2·Q3)의 초성 힌트 표시 여부 { 단계 id: true }
    timer: null, // 기업 회의 타이머 { stepId, endsAt(ms), pausedLeft(ms | null) } — 세 화면이 같은 값을 봄
    teams,
    submissions: { 1: {}, 2: {}, 3: {}, 4: {} },
    rounds: {},
    standings: null,
    socialEvents: [],
    reflections: {},
    log: [],
  };
}

// ── 테스트 시나리오 (어드민 테스트 패널) ─────────────────────────────
const SCENARIOS = {
  random: { label: '랜덤' },
  allExaggerated: { label: '전부 과장 광고', 2: () => 'exaggerated' },
  allCheap: { label: '전부 비용 절감 생산', 3: () => 'cheap' },
  collusion5: { label: '담합 5기업 참여', 4: () => 'join' },
  allDifferent: {
    label: '모두 다른 선택',
    1: (i) => C.PRICE_OPTIONS[i % C.PRICE_OPTIONS.length],
    2: (i) => ['celebrity', 'exaggerated', 'honest'][i % 3],
    3: (i) => ['eco', 'normal', 'cheap'][i % 3],
    4: (i) => (i < 3 ? 'join' : 'no'),
  },
  profitFirst: { label: '모두 이윤 최우선 (과장+절감+담합)', 2: () => 'exaggerated', 3: () => 'cheap', 4: () => 'join' },
  responsible: { label: '모두 책임 경영 (정직+친환경+불참)', 2: () => 'honest', 3: () => 'eco', 4: () => 'no' },
};
export const SCENARIO_LIST = Object.entries(SCENARIOS).map(([key, v]) => ({ key, label: v.label }));

// =====================================================================
export class GameEngine {
  constructor(state) {
    this.state = state && state.version === STATE_VERSION && state.teams ? state : createState();
  }

  get step() {
    return STEP_BY_ID[this.state.stepId] ?? STEPS[0];
  }

  log(msg) {
    this.state.log.unshift({ at: Date.now(), msg });
    this.state.log.length = Math.min(this.state.log.length, 80);
  }

  // ── 초기화 / 접속 ────────────────────────────────────────────────
  reset({ keepClaims = true } = {}) {
    this.state = createState(keepClaims ? this.state.teams : null);
    this.log(`전체 초기화 (${keepClaims ? '모둠 접속 유지' : '모둠 접속도 초기화'})`);
  }

  teamIdByToken(token) {
    if (!token) return null;
    const h = hashToken(token);
    const t = Object.values(this.state.teams).find((x) => x.tokenHash && x.tokenHash === h);
    return t ? t.id : null;
  }

  // 원문 토큰을 돌려줌 (상태에는 해시만 남음)
  claim(teamId) {
    const t = this.state.teams[Number(teamId)];
    if (!t) throw new GameError('기업을 다시 선택해 주세요.');
    if (t.tokenHash && !t.virtual) {
      throw new GameError(`${withJosa(companyName(t.id), '은')} 이미 다른 노트북에서 선택했습니다. 잘못 선택되었다면 선생님께 말씀해 주세요.`, 409);
    }
    const token = crypto.randomBytes(24).toString('hex');
    t.tokenHash = hashToken(token);
    t.virtual = false;
    t.claimedAt = Date.now();
    this.log(`${companyName(t.id)} 접속`);
    return token;
  }

  leave(teamId) {
    if (!['lesson', 'intro'].includes(this.step.kind)) throw new GameError('게임이 시작된 뒤에는 기업을 바꿀 수 없습니다. 선생님께 말씀해 주세요.');
    this.release(teamId);
  }

  release(teamId) {
    const t = this.state.teams[Number(teamId)];
    if (!t) throw new GameError('없는 기업입니다.');
    t.tokenHash = null;
    t.virtual = false;
    t.claimedAt = null;
    this.log(`${companyName(t.id)} 연결 해제`);
  }

  // ── 제출 ─────────────────────────────────────────────────────────
  submit(teamId, body, { byAdmin = false } = {}) {
    const s = this.state;
    const id = Number(teamId);
    const round = Number(body.round);
    const rd = ROUNDS[round];
    const team = s.teams[id];
    if (!rd || !team) throw new GameError('잘못된 요청입니다.');
    if (s.rounds[round]?.computed) throw new GameError('이미 결과가 나온 라운드입니다.');
    if (!byAdmin) {
      const st = this.step;
      if (!(st.kind === 'meeting' && st.round === round)) throw new GameError('지금은 선택을 제출할 수 없습니다. 선생님의 안내를 기다려 주세요.');
    }
    const existing = s.submissions[round][id];
    if (existing && !byAdmin) return { already: true };

    const opt = rd.options.find((o) => String(o.value) === String(body.choice));
    if (!opt) throw new GameError('선택지를 골라 주세요.');
    let reason = cleanText(body.reason).slice(0, C.REASON_MAX_LENGTH);
    if (!byAdmin && reason.length < C.REASON_MIN_LENGTH) throw new GameError('선택한 이유를 써 주세요.');
    if (!reason) reason = '(선생님이 대신 입력)';
    let prediction = null;
    if (rd.prediction) {
      prediction = rd.prediction.options.some((o) => o.value === body.prediction) ? body.prediction : null;
      if (!byAdmin && !prediction) throw new GameError('다른 기업들이 어떻게 결정할지 예상을 골라 주세요.');
    }
    const cost = opt.cost || 0;
    const available = team.cash + (existing?.cost || 0);
    if (cost > available) throw new GameError('현재 가진 돈이 부족하여 선택할 수 없습니다.');

    team.cash = available - cost; // 즉시 차감 (재제출이면 이전 비용 환불 후 차감)
    s.submissions[round][id] = { choice: opt.value, reason, prediction, cost, submittedAt: Date.now(), byAdmin, byDefault: false };
    this.log(`${companyName(id)} ${round}라운드 ${byAdmin ? '대신 ' : ''}제출: ${opt.label}`);
    return { ok: true };
  }

  clearSubmission(teamId, round) {
    const s = this.state;
    const id = Number(teamId);
    if (round === 'reflection') {
      delete s.reflections[id];
      this.log(`${companyName(id)} 정리 활동 제출 초기화`);
      return;
    }
    const r = Number(round);
    if (!ROUNDS[r]) throw new GameError('잘못된 라운드');
    if (s.rounds[r]?.computed) throw new GameError('이미 결과가 계산된 라운드는 초기화할 수 없습니다.');
    const sub = s.submissions[r][id];
    if (!sub) return;
    s.teams[id].cash += sub.cost || 0; // 비용 환불
    delete s.submissions[r][id];
    this.log(`${companyName(id)} ${r}라운드 제출 초기화 (재제출 가능)`);
  }

  reflect(teamId, body, { byAdmin = false } = {}) {
    const s = this.state;
    const id = Number(teamId);
    const team = s.teams[id];
    if (!team) throw new GameError('잘못된 요청입니다.');
    if (!byAdmin && this.step.kind !== 'reflection') throw new GameError('지금은 제출할 수 없습니다. 선생님의 안내를 기다려 주세요.');
    if (s.reflections[id] && !byAdmin) return { already: true };
    const target = body.target;
    const round = DECISION_ROUND[target];
    if (!round) throw new GameError('바꿀 선택을 하나 골라 주세요.');
    const opt = ROUNDS[round].options.find((o) => String(o.value) === String(body.choice));
    if (!opt) throw new GameError('새로운 선택지를 골라 주세요.');
    const from = team.choices[target];
    if (String(opt.value) === String(from)) throw new GameError('원래 선택과 다른 선택지를 골라 주세요.');
    let reason = cleanText(body.reason).slice(0, C.REASON_MAX_LENGTH);
    if (!byAdmin && reason.length < C.REASON_MIN_LENGTH) throw new GameError('바꾸고 싶은 이유를 써 주세요.');
    if (!reason) reason = '(선생님이 대신 입력)';
    s.reflections[id] = { target, round, from, to: opt.value, reason, submittedAt: Date.now(), byAdmin };
    this.log(`${companyName(id)} 정리 활동 제출`);
    return { ok: true };
  }

  // ── 진행 (교사만) ────────────────────────────────────────────────
  isAvailable(st) {
    if (st.kind === 'news') return !!this.news()[st.news];
    return true;
  }

  neighborStep(dir) {
    for (let i = this.step.index + dir; i >= 0 && i < STEPS.length; i += dir) {
      if (this.isAvailable(STEPS[i])) return STEPS[i];
    }
    return null;
  }

  // 한 단계 안에서 클릭마다 나뉘어 보이는 장면 수 (0이면 나뉘지 않음)
  //   score: 0 = 시작 점수 → 1..N = 범주별 감점(소비자 보호·환경·공정 경쟁 중 감점 있는 범주만) → N+1 = 최종 사회점수 + 발문
  //   (뉴스는 제목 타이핑 → 기사 내용이 TV에서 자동으로 이어지므로 나누지 않음)
  //   도입 퀴즈: 0 = 문제(빈칸 퀴즈는 초성 힌트를 따로 켜고 끌 수 있음) → 1 = 정답 공개
  revealTotal(st = this.step) {
    if (st.kind === 'score') return this.scoreCategories().length + 1;
    if (st.quiz) return 1;
    return 0;
  }

  // ── 도입 퀴즈 초성 힌트 (빈칸 퀴즈만) ─────────────────────────────────
  hintShown(st = this.step) {
    return st.quiz === 'blank' && !!this.state.quizHints?.[st.id];
  }

  setHint(st, on) {
    this.state.quizHints = { ...(this.state.quizHints ?? {}), [st.id]: !!on };
  }

  // on 을 주면 그 상태로 (TV·교사 콘솔이 동시에 눌러도 결과가 같음), 없으면 토글. 정답 공개 뒤에는 바꾸지 않음.
  hint(from, on) {
    this.checkFrom(from);
    const st = this.step;
    if (st.quiz !== 'blank') throw new GameError('초성 힌트가 있는 문제(Q2·Q3)에서만 쓸 수 있습니다.');
    if (this.state.revealIndex > 0) return;
    const want = on === undefined || on === null ? !this.hintShown(st) : !!on;
    if (want === this.hintShown(st)) return;
    this.setHint(st, want);
    this.log(`${st.label} · 초성 힌트 ${want ? '공개' : '숨김'}`);
  }

  // 교사 콘솔 표시용: 문제만 → (힌트 공개) → 정답 공개
  quizPhase(st = this.step) {
    if (!st.quiz) return null;
    if (this.state.revealIndex >= 1) return 'answer';
    return this.hintShown(st) ? 'hint' : 'question';
  }

  checkFrom(from, fromReveal, fromHint) {
    if (from && from !== this.state.stepId) throw new GameError('이미 다른 단계로 진행되었습니다. 화면을 확인해 주세요.', 409);
    // 도입 퀴즈 힌트: TV·교사 콘솔이 동시에 ← 를 눌러도 한 단계만 (힌트 숨김과 이전 슬라이드 이동이 겹치지 않게)
    if (typeof fromHint === 'boolean' && this.step.quiz === 'blank' && fromHint !== this.hintShown()) {
      throw new GameError('이미 진행되었습니다.', 409);
    }
    if (fromReveal !== undefined && fromReveal !== null && this.revealTotal() > 0 && Number(fromReveal) !== this.state.revealIndex) {
      throw new GameError('이미 진행되었습니다.', 409);
    }
  }

  // 프레젠터 리모컨(안전 모드): 학생이 아직 결정 중이면 넘기지 않음. 강제 진행은 교사 콘솔에서만.
  presenterBlock(dir) {
    const st = this.step;
    const s = this.state;
    const open = st.round && !s.rounds[st.round]?.computed && TEAM_IDS.some((id) => !s.submissions[st.round][id]);
    if (open && (st.kind === 'meeting' || (st.kind === 'responses' && dir > 0))) return '아직 결정 중인 기업이 있습니다.';
    if (st.kind === 'reflection' && TEAM_IDS.some((id) => !s.reflections[id])) return '아직 정리 활동을 쓰고 있는 기업이 있습니다.';
    return null;
  }

  next(from, fromReveal, { safe = false, fromHint } = {}) {
    this.checkFrom(from, fromReveal, fromHint);
    const block = safe && this.presenterBlock(+1);
    if (block) throw new GameError(block, 423);
    if (this.state.revealIndex < this.revealTotal()) {
      this.state.revealIndex += 1;
      return;
    }
    const nxt = this.neighborStep(+1);
    if (nxt) this.enter(nxt.id, +1);
  }

  prev(from, fromReveal, { safe = false, fromHint } = {}) {
    this.checkFrom(from, fromReveal, fromHint);
    const block = safe && this.presenterBlock(-1);
    if (block) throw new GameError(block, 423);
    if (this.state.revealIndex > 0) {
      this.state.revealIndex -= 1;
      return;
    }
    if (this.hintShown()) {
      // 문제 → 힌트 → 정답 의 한 단계 뒤로: 힌트를 숨김
      this.setHint(this.step, false);
      return;
    }
    const prv = this.neighborStep(-1);
    if (prv) this.enter(prv.id, -1);
  }

  goto(stepId) {
    const st = STEP_BY_ID[stepId];
    if (!st) throw new GameError('없는 단계입니다.');
    // 도입 퀴즈는 어느 쪽에서 이동해도 문제 화면부터
    const dir = st.quiz || st.index >= this.step.index ? +1 : -1;
    this.enter(stepId, dir);
    if (!this.isAvailable(st)) {
      // 발생하지 않은 뉴스로 이동하려 하면 다음 가능한 단계로
      const nxt = this.neighborStep(+1);
      if (nxt) this.enter(nxt.id, +1);
    }
  }

  enter(stepId, dir) {
    const st = STEP_BY_ID[stepId];
    // 결과 단계에 도달하거나 넘어가면, 그 라운드까지 계산 (각 라운드 정확히 1번)
    // 미제출 기업이 있으면 아무것도 계산하지 않고 멈춤 (자동 기본값 없음 — 교사가 대신 지정해야 함)
    const toCompute = [1, 2, 3, 4].filter((r) => st.index >= STEP_BY_ID[`ROUND${r}_RESULT`].index);
    for (const r of toCompute) this.requireSubmissions(r);
    for (const r of toCompute) this.computeRound(r);
    this.holdTimer();
    this.state.stepId = st.id;
    this.state.revealIndex = dir < 0 ? this.revealTotal(st) : 0;
    // 퀴즈에 앞에서 들어오면 문제만 보이는 상태로 시작. 뒤에서 돌아오면 정답 화면 + 그때 쓴 힌트 기록 유지(← 로 복원)
    if (st.quiz && dir > 0) this.setHint(st, false);
    // 기업 회의: 앞에서 들어오면 2분 타이머 새로 시작. 같은 회의로 뒤로 돌아오면 떠날 때 남은 시간부터 이어서
    // (이미 결과가 나온 라운드의 회의 화면은 잠겨 있으므로 타이머를 보여주지 않음 — timerPublic)
    if (st.kind === 'meeting') {
      const t = this.state.timer;
      if (dir > 0 || t?.stepId !== st.id) this.startTimer(st);
      else if (t.held) {
        t.endsAt = Date.now() + t.pausedLeft;
        t.pausedLeft = null;
        t.held = false;
      }
    }
    this.log(`진행: ${st.label}`);
  }

  // ── 기업 회의 타이머 (서버 상태 = 기준. 화면은 받은 남은 시간을 받은 시각부터 줄여 보여줌) ─────
  startTimer(st, ms = C.MEETING_TIMER_MS) {
    this.state.timer = { stepId: st.id, endsAt: Date.now() + ms, pausedLeft: null, held: false };
  }

  // 회의 단계를 떠날 때: 흐르던 타이머를 그 자리에서 멈춰 둠 (held). ← 로 같은 회의에 돌아오면 이어서 흐름
  holdTimer() {
    const t = this.state.timer;
    if (!t || t.stepId !== this.state.stepId || t.pausedLeft != null) return;
    t.pausedLeft = this.timerLeft();
    t.held = true;
  }

  // 회의 단계인데 타이머가 없음 (타이머 도입 전에 이미 회의 단계였던 세션 등) → 교사 콘솔에서 시작 가능
  timerStartable() {
    const st = this.step;
    return st.kind === 'meeting' && !this.state.rounds[st.round]?.computed && !this.timerPublic();
  }

  timerLeft(now = Date.now()) {
    const t = this.state.timer;
    if (!t) return 0;
    return t.pausedLeft ?? Math.max(0, t.endsAt - now);
  }

  // 지금 단계의 회의 타이머 (회의 단계가 아니거나 이미 결과가 나온 라운드면 null)
  timerPublic() {
    const st = this.step;
    const t = this.state.timer;
    if (st.kind !== 'meeting' || !t || t.stepId !== st.id || this.state.rounds[st.round]?.computed) return null;
    return { leftMs: this.timerLeft(), paused: t.pausedLeft != null, durationMs: C.MEETING_TIMER_MS };
  }

  // 교사 콘솔: add(±초) · pause · resume · reset(2분으로)
  timer(from, op, sec) {
    this.checkFrom(from);
    const st = this.step;
    if (this.timerStartable()) this.startTimer(st);
    if (!this.timerPublic()) throw new GameError('기업 회의 중에만 타이머를 조절할 수 있습니다.');
    const t = this.state.timer;
    const now = Date.now();
    const set = (left) => {
      const ms = clamp(Math.round(left), 0, C.MEETING_TIMER_MAX_MS);
      if (t.pausedLeft != null) t.pausedLeft = ms;
      else t.endsAt = now + ms;
    };
    if (op === 'add') {
      const d = Number(sec);
      if (!Number.isFinite(d) || !d) throw new GameError('잘못된 시간입니다.');
      set(this.timerLeft(now) + d * 1000);
      this.log(`${st.label} · 타이머 ${d > 0 ? '+' : '−'}${Math.abs(d)}초`);
    } else if (op === 'pause') {
      if (t.pausedLeft == null) t.pausedLeft = this.timerLeft(now);
      this.log(`${st.label} · 타이머 일시정지`);
    } else if (op === 'resume') {
      if (t.pausedLeft != null) {
        t.endsAt = now + t.pausedLeft;
        t.pausedLeft = null;
      }
      this.log(`${st.label} · 타이머 다시 시작`);
    } else if (op === 'reset') {
      this.startTimer(st);
      this.log(`${st.label} · 타이머 2분으로 초기화`);
    } else throw new GameError('알 수 없는 타이머 명령');
  }

  // ── 미제출 확인 (자동 기본값 없음) ──────────────────────────────────
  missingTeams(r) {
    if (this.state.rounds[r]?.computed) return [];
    return TEAM_IDS.filter((id) => !this.state.submissions[r][id]);
  }

  missingMessage(r, missing = this.missingTeams(r)) {
    return `${joinNamesJosa(missing.map(companyName), '이')} 아직 ${DECISION_OBJECT[r]} 선택하지 않았습니다. 강제 진행하려면 교사 대신 선택을 지정해 주세요.`;
  }

  requireSubmissions(r) {
    const missing = this.missingTeams(r);
    if (missing.length) throw new GameError(this.missingMessage(r, missing), 409);
  }

  // ── 시장 계산 (라운드당 정확히 1번, idempotent) ────────────────────
  computeRound(r) {
    const s = this.state;
    if (s.rounds[r]?.computed) return;
    for (let q = 1; q < r; q++) this.computeRound(q);
    this.requireSubmissions(r);

    const subs = s.submissions[r];
    const key = ROUNDS[r].key;
    for (const id of TEAM_IDS) s.teams[id].choices[key] = subs[id].choice;

    const members = r === 4 ? TEAM_IDS.filter((id) => subs[id].choice === 'join') : [];
    const n = members.length;
    const eff = C.COLLUSION_EFFECTS[n] ?? { MEMBER_BASE_SALES: 0, NON_MEMBER_MULTIPLIER: 1 };
    const isMember = (id) => members.includes(id);
    const priceOf = (id) => (isMember(id) ? C.COLLUSION_PRICE : s.teams[id].choices.price);
    const prev = s.rounds[r - 1];
    const prevRank = Object.fromEntries((prev?.standings ?? []).map((x) => [x.teamId, x.rank]));

    const results = {};
    for (const id of TEAM_IDS) {
      const t = s.teams[id];
      const price = priceOf(id);
      const adMult = r >= 2 ? C.AD_MULTIPLIERS[t.choices.ad] ?? 1 : 1;
      const variance = s.variance[id]?.[r] ?? 1;
      let base;
      let rel = 1;
      let extra = 1;
      if (isMember(id)) {
        base = eff.MEMBER_BASE_SALES;
      } else {
        base = C.BASE_SALES_BY_PRICE[price] ?? 0;
        rel = relativePriceFactor(price, TEAM_IDS.filter((o) => o !== id).map(priceOf));
        if (r === 4 && n > 0) extra = eff.NON_MEMBER_MULTIPLIER;
      }
      const units = Math.max(0, Math.round(base * rel * adMult * extra * variance));
      const revenue = units * price;
      const profitBefore = prev ? prev.results[id].profitAfter : 0;
      t.cash += revenue;
      t.revenueTotal += revenue;
      t.unitsTotal += units;
      results[id] = {
        units, price, revenue,
        spent: subs[id].cost || 0,
        profitBefore,
        profitAfter: t.cash - C.STARTING_CASH,
        cashAfter: t.cash,
        member: isMember(id),
        rankBefore: prevRank[id] ?? null,
        rankAfter: null,
        internal: { base, rel: +rel.toFixed(4), adMult, extra, variance },
      };
    }
    const standings = this.currentStandings();
    for (const x of standings) results[x.teamId].rankAfter = x.rank;

    s.rounds[r] = {
      computed: true,
      computedAt: Date.now(),
      results,
      standings,
      collusion: r === 4 ? { members, count: n } : null,
    };
    s.standings = standings;
    this.addSocialEvents(r, members);
    this.log(`${r}라운드 시장 결과 계산 완료`);
  }

  currentStandings() {
    const list = TEAM_IDS.map((id) => ({ teamId: id, profit: this.state.teams[id].cash - C.STARTING_CASH }));
    list.sort((a, b) => b.profit - a.profit || a.teamId - b.teamId);
    // 동률은 공동 순위 (1,1,3 …), 표시 순서는 기업 번호 순
    for (const x of list) x.rank = 1 + list.filter((y) => y.profit > x.profit).length;
    return list;
  }

  addSocialEvents(r, members) {
    const s = this.state;
    s.socialEvents = s.socialEvents.filter((e) => e.round !== r);
    const D = C.SOCIAL_SCORE_DELTAS;
    if (r === 2 || r === 3) {
      const table = r === 2 ? D.AD : D.PRODUCTION;
      const category = r === 2 ? 'consumer' : 'environment';
      for (const id of TEAM_IDS) {
        const choice = s.teams[id].choices[r === 2 ? 'ad' : 'production'];
        const delta = table[choice] ?? 0;
        if (delta) {
          s.socialEvents.push({ round: r, category, cause: choice, causeLabel: optionLabel(r, choice), teamIds: [id], delta, perTeam: delta, news: category });
        }
      }
    }
    if (r === 4) {
      const n = members.length;
      const delta = D.COLLUSION_BY_COUNT[n] ?? 0;
      if (delta) {
        s.socialEvents.push({
          round: 4, category: 'fairness', cause: 'collusion', causeLabel: `담합 참여 ${n} / ${TOTAL} 기업`,
          teamIds: members, delta, perTeam: Math.round((delta / n) * 10) / 10, news: 'fairness',
        });
      }
    }
  }

  socialScore() {
    return C.SOCIAL_SCORE_START + this.state.socialEvents.reduce((a, e) => a + e.delta, 0);
  }

  scoreItems() {
    const order = { consumer: 0, environment: 1, fairness: 2 };
    const events = [...this.state.socialEvents].sort((a, b) => order[a.category] - order[b.category] || a.teamIds[0] - b.teamIds[0]);
    let score = C.SOCIAL_SCORE_START;
    return events.map((e) => {
      const before = score;
      score += e.delta;
      const single = e.teamIds.length === 1;
      return {
        category: e.category,
        categoryLabel: CATEGORY_LABELS[e.category],
        title: single ? `${companyName(e.teamIds[0])} — ${e.causeLabel}` : e.causeLabel,
        companies: single ? [] : e.teamIds.map((id) => ({ id, name: companyName(id), color: colorOf(id) })),
        delta: e.delta,
        before,
        after: score,
      };
    });
  }

  // TV 사회점수 공개용: 기업별 사회 이벤트(원본은 그대로 보존)를 범주별 합계로 묶음. 감점 0인 범주는 건너뜀.
  scoreCategories() {
    const ev = this.state.socialEvents;
    const chips = (ids) => ids.map((id) => ({ id, name: companyName(id), color: colorOf(id) }));
    const cats = [];
    let score = C.SOCIAL_SCORE_START;
    for (const category of CATEGORY_ORDER) {
      const list = ev.filter((e) => e.category === category);
      const delta = list.reduce((a, e) => a + e.delta, 0);
      if (!delta) continue;
      let groups;
      if (category === 'fairness') {
        const ids = [...new Set(list.flatMap((e) => e.teamIds))].sort((a, b) => a - b);
        groups = [{ label: `공동 가격 제안 참여 ${ids.length} / ${TOTAL} 기업`, count: ids.length, delta, companies: chips(ids) }];
      } else {
        const r = category === 'consumer' ? 2 : 3;
        const causes = ROUNDS[r].options.map((o) => o.value).filter((v) => list.some((e) => e.cause === v));
        groups = causes.map((cause) => {
          const of = list.filter((e) => e.cause === cause);
          const ids = of.flatMap((e) => e.teamIds).sort((a, b) => a - b);
          const label = optionLabel(r, cause);
          return {
            label: category === 'consumer' ? `${label}${josa(label, '을')} 선택한 기업 ${ids.length}곳` : `${label} ${ids.length}곳`,
            count: ids.length,
            delta: of.reduce((a, e) => a + e.delta, 0),
            companies: chips(ids),
          };
        });
      }
      const before = score;
      score += delta;
      cats.push({ category, label: CATEGORY_LABELS[category], groups, delta, before, after: score });
    }
    return cats;
  }

  // 사회점수 공개가 어디까지 왔는지 (교사 콘솔 표시용)
  scorePhases() {
    const cats = this.scoreCategories();
    const idx = this.step.kind === 'score' ? this.state.revealIndex : -1;
    const list = [{ key: 'start', label: '사회점수 시작', reveal: 0 }];
    for (const category of CATEGORY_ORDER) {
      const at = cats.findIndex((c) => c.category === category);
      list.push({ key: category, label: `${CATEGORY_LABELS[category]} 공개`, reveal: at >= 0 ? at + 1 : null, skipped: at < 0 });
    }
    list.push({ key: 'final', label: '최종 발문', reveal: cats.length + 1 });
    return list.map((p) => ({ ...p, current: p.reveal === idx, done: p.reveal != null && p.reveal < idx }));
  }

  news() {
    return buildNews(this.state);
  }

  // ── 화면 데이터 (역할별로 필요한 것만) ─────────────────────────────
  base(role) {
    const s = this.state;
    return { role, sessionId: s.sessionId, rev: s.rev, step: stepPublic(this.step), serverTime: Date.now() };
  }

  companiesPublic(conns) {
    return COMPANIES.map((c) => {
      const t = this.state.teams[c.id];
      return { id: c.id, name: c.name, color: c.color, claimed: !!t.tokenHash, connected: (conns[c.id] || 0) > 0 || t.virtual };
    });
  }

  submittedCount() {
    const st = this.step;
    if (st.round) return Object.keys(this.state.submissions[st.round]).length;
    if (st.kind === 'reflection' || st.kind === 'reflectionResponses') return Object.keys(this.state.reflections).length;
    return 0;
  }

  subPublic(round, id) {
    const sub = this.state.submissions[round]?.[id];
    if (!sub) return null;
    const opt = optionOf(round, sub.choice);
    const pred = ROUNDS[round].prediction?.options.find((o) => o.value === sub.prediction);
    return {
      choice: sub.choice,
      choiceLabel: opt?.label ?? '-',
      sentence: opt?.sentence ?? null,
      reason: sub.reason,
      predictionLabel: pred?.label ?? null,
      cost: sub.cost,
      byAdmin: sub.byAdmin,
      byDefault: sub.byDefault,
    };
  }

  responsesPublic(round) {
    return COMPANIES.map((c) => ({ teamId: c.id, name: c.name, color: c.color, ...(this.subPublic(round, c.id) ?? { choiceLabel: null }) }));
  }

  resultPublic(round, id) {
    const res = this.state.rounds[round]?.results?.[id];
    if (!res) return null;
    const { internal, ...pub } = res;
    return { teamId: id, name: companyName(id), color: colorOf(id), ...pub };
  }

  standingsPublic(round) {
    const rd = round ? this.state.rounds[round] : null;
    const standings = rd ? rd.standings : this.state.standings;
    if (!standings) return null;
    const prevRank = Object.fromEntries((this.state.rounds[round - 1]?.standings ?? []).map((x) => [x.teamId, x.rank]));
    return standings.map((x) => ({ ...x, name: companyName(x.teamId), color: colorOf(x.teamId), rankBefore: prevRank[x.teamId] ?? null }));
  }

  collusionPublic() {
    const col = this.state.rounds[4]?.collusion;
    if (!col) return null;
    return { count: col.count, total: TOTAL, members: col.members.map((id) => ({ id, name: companyName(id), color: colorOf(id) })) };
  }

  reflectionsPublic() {
    return COMPANIES.map((c) => {
      const f = this.state.reflections[c.id];
      if (!f) return { teamId: c.id, name: c.name, color: c.color, submitted: false };
      return {
        teamId: c.id, name: c.name, color: c.color, submitted: true,
        decisionLabel: ROUNDS[f.round].decisionLabel,
        fromLabel: optionLabel(f.round, f.from),
        toLabel: optionLabel(f.round, f.to),
        reason: f.reason,
      };
    });
  }

  headlines() {
    return Object.values(this.news()).filter(Boolean).map((n) => ({ category: n.category, headline: n.headline }));
  }

  displayView(conns = {}) {
    const st = this.step;
    const s = this.state;
    const v = { ...this.base('display'), companies: this.companiesPublic(conns), submittedCount: this.submittedCount(), totalTeams: TOTAL };
    if (st.kind === 'meeting') v.submittedTeams = Object.keys(s.submissions[st.round]).map(Number);
    v.timer = this.timerPublic();
    if (st.kind === 'reflection') v.submittedTeams = Object.keys(s.reflections).map(Number);
    if (st.round) v.roundInfo = ROUNDS[st.round];
    if (['responses', 'result', 'rank'].includes(st.kind)) v.responses = this.responsesPublic(st.round);
    if (['result', 'rank'].includes(st.kind) && s.rounds[st.round]?.computed) {
      v.results = TEAM_IDS.map((id) => this.resultPublic(st.round, id));
      v.standings = this.standingsPublic(st.round);
      if (st.round === 4) v.collusion = this.collusionPublic();
    }
    if (st.kind === 'final') {
      v.standings = this.standingsPublic(4);
      v.collusion = this.collusionPublic();
    }
    if (this.revealTotal() > 0) v.reveal = { index: s.revealIndex, total: this.revealTotal() };
    if (st.kind === 'news') v.news = this.news()[st.news];
    if (st.kind === 'paper') v.headlines = this.headlines();
    if (st.kind === 'score') {
      const cats = this.scoreCategories();
      const done = s.revealIndex > cats.length;
      v.score = {
        start: C.SOCIAL_SCORE_START,
        categories: cats.slice(0, Math.min(s.revealIndex, cats.length)),
        total: cats.length,
        revealIndex: s.revealIndex,
        final: done ? this.socialScore() : null,
        done,
        questions: done ? SCORE_QUESTIONS : null,
      };
    }
    if (st.kind === 'reflectionResponses') v.reflections = this.reflectionsPublic();
    if (st.kind === 'closing') v.closing = CLOSING_TEXT;
    if (st.kind === 'lesson') v.lesson = this.lessonPublic(st);
    if (st.kind === 'concept') v.concept = CONCEPT[st.slide];
    return v;
  }

  // 도입 슬라이드 내용. 퀴즈의 초성 힌트·정답은 그 단계가 공개되었을 때만 보냄.
  lessonPublic(st) {
    const c = LESSON[st.slide];
    if (!st.quiz) return st.slide === 'companies' ? { ...c, companies: COMPANIES } : c;
    const revealed = this.state.revealIndex >= 1;
    const { answer, formula, hints, answers, ...rest } = c;
    const out = { ...rest, phase: this.quizPhase(st), revealed, hint: this.hintShown(st) };
    if (c.type === 'choice' && revealed) Object.assign(out, { answer, formula });
    if (c.type === 'blank') {
      out.blanks = hints.length;
      if (out.hint && !revealed) out.hints = hints;
      if (revealed) out.answers = answers;
    }
    return out;
  }

  teamView(teamId, conns = {}, { tokenRejected = false } = {}) {
    const s = this.state;
    const st = this.step;
    const v = { ...this.base('play'), companies: this.companiesPublic(conns), totalTeams: TOTAL, tokenRejected };
    if (!teamId) return { ...v, me: null };
    const t = s.teams[teamId];
    const standing = s.standings?.find((x) => x.teamId === teamId);
    v.me = {
      id: teamId, name: companyName(teamId), color: colorOf(teamId),
      cash: t.cash, revenueTotal: t.revenueTotal, profit: t.cash - C.STARTING_CASH,
      rank: standing?.rank ?? null, connections: conns[teamId] || 0,
    };
    v.limits = { min: C.REASON_MIN_LENGTH, max: C.REASON_MAX_LENGTH };
    v.submittedCount = this.submittedCount();
    if (st.round) {
      const r = st.round;
      v.roundInfo = ROUNDS[r];
      v.roundComputed = !!s.rounds[r]?.computed;
      v.mySubmission = this.subPublic(r, teamId);
      v.canSubmit = st.kind === 'meeting' && !v.roundComputed && !v.mySubmission;
      v.timer = this.timerPublic();
      if (['result', 'rank'].includes(st.kind) && v.roundComputed) {
        v.myResult = this.resultPublic(r, teamId);
        if (r === 4) v.collusion = { count: s.rounds[4].collusion.count, total: TOTAL };
      }
    }
    if (st.kind === 'final') v.standings = this.standingsPublic(4);
    if (['reflection', 'reflectionResponses', 'closing'].includes(st.kind)) {
      v.reflection = {
        ...REFLECTION,
        decisions: Object.entries(DECISION_ROUND).map(([target, round]) => ({
          target, round,
          decisionLabel: ROUNDS[round].decisionLabel,
          current: t.choices[target],
          currentLabel: optionLabel(round, t.choices[target]),
          options: ROUNDS[round].options.map((o) => ({ value: o.value, label: o.label, desc: o.desc })),
        })),
        mine: s.reflections[teamId]
          ? (() => {
            const f = s.reflections[teamId];
            return { ...f, decisionLabel: ROUNDS[f.round].decisionLabel, fromLabel: optionLabel(f.round, f.from), toLabel: optionLabel(f.round, f.to) };
          })()
          : null,
        canReflect: st.kind === 'reflection' && !s.reflections[teamId],
      };
    }
    if (st.kind === 'closing') v.closing = CLOSING_TEXT;
    return v;
  }

  nextActionInfo() {
    const st = this.step;
    const s = this.state;
    if (st.kind === 'score') {
      const cats = this.scoreCategories();
      if (s.revealIndex < cats.length) {
        const c = cats[s.revealIndex];
        return { label: `${c.label} 감점 공개 (${s.revealIndex + 1} / ${cats.length})`, toLabel: `사회점수 · ${c.label}`, warning: null };
      }
      if (s.revealIndex === cats.length) return { label: '최종 사회점수 · 발문 보여주기', toLabel: '최종 사회점수 · 발문', warning: null };
    }
    if (st.quiz && s.revealIndex < 1) return { label: '정답 공개', toLabel: `${st.label.replace('도입 · ', '')} · 정답 공개`, warning: null };
    const nxt = this.neighborStep(+1);
    if (!nxt) return null;
    let warning = null;
    let assign = null;
    if (st.round && (st.kind === 'meeting' || st.kind === 'responses')) {
      const missing = this.missingTeams(st.round);
      if (missing.length && st.kind === 'meeting') warning = `아직 제출하지 않은 기업: ${missing.map(companyName).join(', ')}`;
      if (missing.length && st.kind === 'responses') {
        // 다음 단계에서 결과가 계산됨 → 미제출 기업의 선택을 교사가 지정해야 진행 가능 (자동 기본값 없음)
        warning = this.missingMessage(st.round, missing);
        assign = { round: st.round, teamIds: missing };
      }
    }
    if (st.kind === 'reflection') {
      const missing = TEAM_IDS.filter((id) => !s.reflections[id]).map(companyName);
      if (missing.length) warning = `아직 제출하지 않은 기업: ${missing.join(', ')}`;
    }
    return { label: nxt.enterLabel ?? nxt.label, toLabel: nxt.label, toId: nxt.id, warning, assign };
  }

  adminView(conns = {}) {
    const s = this.state;
    const st = this.step;
    const prv = s.revealIndex > 0 ? { label: st.quiz ? '정답 숨기기' : '사회점수 이전 장면' }
      : this.hintShown() ? { label: '초성 힌트 숨기기' } : this.neighborStep(-1);
    return {
      ...this.base('admin'),
      createdAt: s.createdAt,
      revealIndex: s.revealIndex,
      revealTotal: this.revealTotal(),
      scorePhases: this.scorePhases(),
      quiz: st.quiz ? { type: st.quiz, phase: this.quizPhase(), hint: this.hintShown() } : null,
      timer: this.timerPublic(),
      timerStartable: this.timerStartable(),
      nextAction: this.nextActionInfo(),
      prevLabel: prv?.label ?? null,
      steps: STEPS.map((x) => ({
        ...stepPublic(x),
        available: this.isAvailable(x),
        conditional: x.kind === 'news',
        current: x.id === s.stepId,
      })),
      teams: TEAM_IDS.map((id) => {
        const t = s.teams[id];
        const standing = s.standings?.find((x) => x.teamId === id);
        return {
          id, name: companyName(id), color: colorOf(id),
          claimed: !!t.tokenHash, virtual: t.virtual, connections: conns[id] || 0,
          cash: t.cash, revenueTotal: t.revenueTotal, unitsTotal: t.unitsTotal,
          profit: t.cash - C.STARTING_CASH, rank: standing?.rank ?? null,
          choices: Object.fromEntries(Object.entries(DECISION_ROUND).map(([k, r]) => [k, t.choices[k] == null ? null : optionLabel(r, t.choices[k])])),
        };
      }),
      submissions: Object.fromEntries([1, 2, 3, 4].map((r) => [r, Object.fromEntries(TEAM_IDS.map((id) => [id, this.subPublic(r, id)]))])),
      rounds: Object.fromEntries([1, 2, 3, 4].map((r) => [r, s.rounds[r] ? { computed: true, results: s.rounds[r].results, collusion: s.rounds[r].collusion } : { computed: false }])),
      roundOptions: ROUNDS,
      social: {
        score: this.socialScore(),
        start: C.SOCIAL_SCORE_START,
        items: this.scoreItems(),
        events: s.socialEvents.map((e) => ({ ...e, categoryLabel: CATEGORY_LABELS[e.category], names: e.teamIds.map(companyName) })),
      },
      news: this.news(),
      reflections: this.reflectionsPublic(),
      scenarios: SCENARIO_LIST,
      config: C,
      log: s.log.slice(0, 30),
    };
  }

  // ── 테스트 패널 ──────────────────────────────────────────────────
  testAutoJoin() {
    for (const id of TEAM_IDS) {
      const t = this.state.teams[id];
      if (!t.tokenHash) {
        t.tokenHash = `virtual-${crypto.randomBytes(8).toString('hex')}`;
        t.virtual = true;
        t.claimedAt = Date.now();
      }
    }
    this.log('테스트: 빈 기업 자동 접속 처리');
  }

  scenarioChoice(scenarioKey, round, index, id) {
    const sc = SCENARIOS[scenarioKey] ?? SCENARIOS.random;
    const cash = this.state.teams[id].cash;
    const affordable = ROUNDS[round].options.filter((o) => (o.cost || 0) <= cash);
    const want = sc[round]?.(index);
    return affordable.find((o) => String(o.value) === String(want))?.value ?? pick(affordable).value;
  }

  testAutoSubmit(scenarioKey, round = this.step.round) {
    const r = Number(round);
    if (!ROUNDS[r]) throw new GameError('라운드 진행 중에만 자동 제출할 수 있습니다.');
    if (this.state.rounds[r]?.computed) throw new GameError('이미 계산된 라운드입니다.');
    TEAM_IDS.forEach((id, i) => {
      if (this.state.submissions[r][id]) return;
      const choice = this.scenarioChoice(scenarioKey, r, i, id);
      const prediction = ROUNDS[r].prediction ? pick(ROUNDS[r].prediction.options).value : null;
      this.submit(id, { round: r, choice, reason: `(테스트) ${pick(SAMPLE_REASONS[r])}`, prediction }, { byAdmin: true });
    });
  }

  testAutoComplete(scenarioKey) {
    for (let r = 1; r <= 4; r++) {
      if (!this.state.rounds[r]?.computed) {
        this.testAutoSubmit(scenarioKey, r);
        this.computeRound(r);
      }
    }
    this.enter('FINAL_PROFIT', +1);
    this.log(`테스트: '${SCENARIOS[scenarioKey]?.label ?? scenarioKey}' 시나리오로 4라운드 자동 완료`);
  }

  testAutoReflect() {
    for (const id of TEAM_IDS) {
      if (this.state.reflections[id]) continue;
      const t = this.state.teams[id];
      const target = pick(Object.keys(DECISION_ROUND).filter((k) => t.choices[k] != null));
      if (!target) throw new GameError('4라운드까지 끝난 뒤에 사용할 수 있습니다.');
      const round = DECISION_ROUND[target];
      const choice = pick(ROUNDS[round].options.filter((o) => String(o.value) !== String(t.choices[target]))).value;
      this.reflect(id, { target, choice, reason: `(테스트) ${pick(SAMPLE_REASONS.reflection)}` }, { byAdmin: true });
    }
  }
}
