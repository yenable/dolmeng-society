// 게임 엔진 단위 테스트: node scripts/engine-test.js
import assert from 'node:assert/strict';
import { GameEngine, STEPS } from '../src/engine.js';
import { TEAM_IDS } from '../src/content.js';
import { GAME_CONFIG as C } from '../src/config.js';

let passed = 0;
const test = (name, fn) => {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.error(`  ✗ ${name}\n    ${e.stack}`);
    process.exitCode = 1;
  }
};
const conns = {};
// 테스트 편의: 목표 단계까지 계산이 필요한 라운드의 미제출 기업은 무작위로 채운 뒤 이동 (실제 게임에는 자동 기본값 없음)
const goto = (g, id) => {
  const target = STEPS.find((s) => s.id === id).index;
  for (let r = 1; r <= 4; r++) {
    if (target >= STEPS.find((s) => s.id === `ROUND${r}_RESULT`).index && !g.state.rounds[r]?.computed) g.testAutoSubmit('random', r);
  }
  g.goto(id);
};
const submitAll = (g, r, choices, extra = {}) => TEAM_IDS.forEach((id, i) => g.submit(id, { round: r, choice: choices[i], reason: '테스트 이유', prediction: 'half', ...extra }, { byAdmin: true }));

console.log('엔진 테스트');

test('학생은 회의 단계에서만 제출 가능, 중복 제출은 1번만 반영', () => {
  const g = new GameEngine();
  g.testAutoJoin();
  assert.throws(() => g.submit(1, { round: 1, choice: 10000, reason: '싸니까요' }), /제출할 수 없습니다/);
  goto(g, 'ROUND1_MEETING');
  g.submit(1, { round: 1, choice: 10000, reason: '싸니까요' });
  const r = g.submit(1, { round: 1, choice: 20000, reason: '비싸게' });
  assert.equal(r.already, true);
  assert.equal(g.state.submissions[1][1].choice, 10000);
});

test('이유가 없으면 제출 불가, 4라운드는 예상도 필수', () => {
  const g = new GameEngine();
  goto(g, 'ROUND1_MEETING');
  assert.throws(() => g.submit(1, { round: 1, choice: 10000, reason: ' ' }), /이유/);
  goto(g, 'ROUND4_MEETING');
  assert.throws(() => g.submit(1, { round: 4, choice: 'join', reason: '돈을 벌려고' }), /예상/);
});

test('비용 즉시 차감 · 초기화하면 환불 · 돈이 부족하면 선택 불가', () => {
  const g = new GameEngine();
  goto(g, 'ROUND2_MEETING'); // 1라운드 자동 계산
  const cash = g.state.teams[1].cash;
  g.submit(1, { round: 2, choice: 'celebrity', reason: '유명하니까' });
  assert.equal(g.state.teams[1].cash, cash - C.AD_COSTS.celebrity);
  g.clearSubmission(1, 2);
  assert.equal(g.state.teams[1].cash, cash);
  g.state.teams[1].cash = 10_000;
  assert.throws(() => g.submit(1, { round: 2, choice: 'honest', reason: '정직' }), /현재 가진 돈이 부족/);
});

test('라운드 결과는 정확히 1번만 계산 (idempotent)', () => {
  const g = new GameEngine();
  goto(g, 'ROUND1_MEETING');
  submitAll(g, 1, [5000, 10000, 15000, 20000, 10000]);
  goto(g, 'ROUND1_RESULT');
  const snapshot = JSON.stringify(g.state.teams);
  g.computeRound(1);
  goto(g, 'ROUND1_RESPONSES');
  goto(g, 'ROUND1_RESULT');
  g.next('ROUND1_RESULT');
  g.prev('ROUND1_RANK');
  assert.equal(JSON.stringify(g.state.teams), snapshot);
  assert.throws(() => g.clearSubmission(1, 1), /초기화할 수 없습니다/);
});

test('버튼 연타: 같은 단계에서 보낸 두 번째 [다음]은 무시', () => {
  const g = new GameEngine();
  g.goto('INTRO');
  g.next('INTRO');
  assert.equal(g.state.stepId, 'ROUND1_SCENE');
  assert.throws(() => g.next('INTRO'), (e) => e.status === 409);
  assert.equal(g.state.stepId, 'ROUND1_SCENE');
});

test('미제출 기업에 기본값(광고 안 함 등)을 자동 적용하지 않음 · 교사가 지정해야 계산', () => {
  const g = new GameEngine();
  g.testAutoJoin();
  goto(g, 'ROUND2_MEETING');
  [1, 2, 4, 5].forEach((id) => g.submit(id, { round: 2, choice: 'honest', reason: '정직' }, { byAdmin: true }));
  g.next('ROUND2_MEETING'); // 회의 → 선택 공개 (계산 없음)
  assert.equal(g.state.stepId, 'ROUND2_RESPONSES');
  const cash = g.state.teams[3].cash;
  assert.throws(() => g.next('ROUND2_RESPONSES'), /몽글기업이 아직 광고 방법을 선택하지 않았습니다\. 강제 진행하려면 교사 대신 선택을 지정해 주세요\./);
  assert.throws(() => g.goto('FINAL_PROFIT'), /몽글기업이/);
  assert.equal(g.state.stepId, 'ROUND2_RESPONSES');
  assert.equal(g.state.rounds[2], undefined);
  assert.equal(g.state.submissions[2][3], undefined);
  assert.equal(g.state.teams[3].cash, cash);
  assert.equal(g.adminView().nextAction.assign.teamIds[0], 3);
  // 교사가 대신 지정 → 진행
  g.submit(3, { round: 2, choice: 'celebrity', reason: '' }, { byAdmin: true });
  g.next('ROUND2_RESPONSES');
  assert.equal(g.state.teams[3].choices.ad, 'celebrity');
  assert.ok(!['none', null].includes(g.state.teams[3].choices.ad));
  // 생산 라운드도 동일
  goto(g, 'ROUND3_MEETING');
  [1, 2, 3, 4].forEach((id) => g.submit(id, { round: 3, choice: 'eco', reason: '환경' }, { byAdmin: true }));
  g.next('ROUND3_MEETING');
  assert.throws(() => g.next('ROUND3_RESPONSES'), /젤리팩토리가 아직 생산 방법을 선택하지 않았습니다/);
  assert.equal(g.state.rounds[3], undefined);
  assert.equal(g.state.teams[5].choices.production, null);
  assert.ok(!('none' in C.AD_COSTS) && !('none' in C.AD_MULTIPLIERS));
});

test('광고 효과는 2·3·4라운드 모두 적용, 생산은 판매량에 영향 없음', () => {
  const g = new GameEngine();
  g.testAutoJoin();
  goto(g, 'ROUND1_MEETING');
  submitAll(g, 1, [10000, 10000, 10000, 10000, 10000]);
  goto(g, 'ROUND2_MEETING');
  submitAll(g, 2, ['celebrity', 'honest', 'honest', 'honest', 'honest']);
  goto(g, 'ROUND3_MEETING');
  submitAll(g, 3, ['cheap', 'eco', 'eco', 'eco', 'eco']);
  goto(g, 'ROUND4_MEETING');
  submitAll(g, 4, ['no', 'no', 'no', 'no', 'no']);
  goto(g, 'FINAL_PROFIT');
  for (const r of [2, 3, 4]) {
    const res = g.state.rounds[r].results[1];
    assert.equal(res.internal.adMult, C.AD_MULTIPLIERS.celebrity);
  }
  // 생산 방식이 달라도 판매량 계산 요소는 같음 (변동값 제외)
  const a = g.state.rounds[3].results[1].internal;
  assert.equal(a.base, C.BASE_SALES_BY_PRICE[10000]);
});

test('담합: 참여 기업은 30,000원, 불참 기업은 원래 가격', () => {
  const g = new GameEngine();
  goto(g, 'ROUND1_MEETING');
  submitAll(g, 1, [10000, 10000, 5000, 15000, 20000]);
  goto(g, 'ROUND4_MEETING');
  submitAll(g, 4, ['join', 'join', 'join', 'join', 'no']);
  goto(g, 'ROUND4_RESULT');
  const res = g.state.rounds[4].results;
  assert.equal(res[1].price, C.COLLUSION_PRICE);
  assert.equal(res[5].price, 20000);
  assert.equal(g.state.rounds[4].collusion.count, 4);
});

test('사회점수: 과장광고·생산·담합 누적, 음수까지 내려감 (DB 원본은 기업별, TV는 범주별 합계)', () => {
  const g = new GameEngine();
  g.testAutoJoin();
  g.testAutoComplete('profitFirst');
  // 과장 -20×5, 비용절감 -20×5, 담합 5곳 -30 → 100 - 230 = -130
  assert.equal(g.socialScore(), -130);
  const items = g.scoreItems();
  assert.equal(items.length, 11); // 기업별 원본 이벤트 그대로
  assert.equal(items.at(-1).after, -130);
  const cats = g.scoreCategories();
  assert.deepEqual(cats.map((c) => [c.category, c.delta, c.after]), [['consumer', -100, 0], ['environment', -100, -100], ['fairness', -30, -130]]);
});

test('사회점수 예시: 과장 3 · 일반 1 · 절감 2 · 담합 4 → 100 → 40 → -10 → -40', () => {
  const g = new GameEngine();
  g.testAutoJoin();
  goto(g, 'ROUND1_MEETING');
  submitAll(g, 1, [10000, 10000, 10000, 10000, 10000]);
  goto(g, 'ROUND2_MEETING');
  submitAll(g, 2, ['exaggerated', 'celebrity', 'exaggerated', 'honest', 'exaggerated']);
  goto(g, 'ROUND3_MEETING');
  submitAll(g, 3, ['cheap', 'normal', 'cheap', 'eco', 'eco']);
  goto(g, 'ROUND4_MEETING');
  submitAll(g, 4, ['join', 'join', 'join', 'join', 'no']);
  goto(g, 'SOCIAL_SCORE_REVEAL');
  const cats = g.scoreCategories();
  assert.deepEqual(cats.map((c) => c.before), [100, 40, -10]);
  assert.deepEqual(cats.map((c) => c.after), [40, -10, -40]);
  assert.deepEqual(cats[0].groups.map((x) => x.label), ['과장 광고를 선택한 기업 3곳']);
  assert.deepEqual(cats[0].groups[0].companies.map((x) => x.name), ['말랑컴퍼니', '몽글기업', '젤리팩토리']);
  assert.deepEqual(cats[1].groups.map((x) => [x.label, x.delta]), [['일반 생산 1곳', -10], ['비용 절감 생산 2곳', -40]]);
  assert.equal(cats[2].groups[0].label, '공동 가격 제안 참여 4 / 5 기업');
  assert.equal(cats[2].groups[0].companies.length, 4);
  // 기업별 원본은 덮어쓰지 않음
  assert.equal(g.state.socialEvents.filter((e) => e.category === 'consumer').length, 3);
  // TV 진행: 시작 → 소비자 → 환경 → 공정 → 최종 발문 → 정리
  const seen = [];
  for (let i = 0; i < 6; i++) {
    const v = g.displayView(conns);
    if (v.step.kind !== 'score') break;
    seen.push(v.score.done ? `final:${v.score.final}` : v.score.categories.length ? v.score.categories.at(-1).after : v.score.start);
    g.next('SOCIAL_SCORE_REVEAL', g.state.revealIndex);
  }
  assert.deepEqual(seen, [100, 40, -10, -40, 'final:-40']);
  assert.equal(g.state.stepId, 'REFLECTION');
});

test('뉴스는 실제 선택 기반 · 조사 자동 · 발생하지 않은 뉴스는 건너뜀', () => {
  const g = new GameEngine();
  goto(g, 'ROUND2_MEETING');
  submitAll(g, 2, ['honest', 'exaggerated', 'exaggerated', 'honest', 'celebrity']);
  goto(g, 'ROUND3_MEETING');
  submitAll(g, 3, ['eco', 'eco', 'eco', 'eco', 'eco']);
  goto(g, 'ROUND4_MEETING');
  submitAll(g, 4, ['join', 'no', 'no', 'no', 'no']);
  goto(g, 'FINAL_PROFIT');
  const news = g.news();
  assert.match(news.consumer.lines[0], /^통통슬라임과 몽글기업이 /);
  assert.equal(news.environment, null);
  assert.equal(news.fairness, null); // 1곳 참여 = 무산
  g.next('FINAL_PROFIT');
  assert.equal(g.state.stepId, 'BLACKOUT');
  g.next('BLACKOUT');
  assert.equal(g.state.stepId, 'NEWS_CONSUMER');
  assert.equal(g.state.revealIndex, 0);
  assert.ok(g.displayView(conns).news.lines.length > 0); // 제목 → 기사 내용은 TV에서 자동으로 이어짐 (클릭 없음)
  g.next('NEWS_CONSUMER', 0);
  assert.equal(g.state.stepId, 'SOCIAL_PAPER'); // 다음 클릭 = 다음 기사 (환경·공정 뉴스는 발생하지 않아 건너뜀)
  assert.ok(g.displayView(conns).headlines.length >= 1);
  g.prev('SOCIAL_PAPER');
  assert.deepEqual([g.state.stepId, g.state.revealIndex], ['NEWS_CONSUMER', 0]);
  assert.equal(g.socialScore(), 60);
});

test('사회점수 공개는 범주별로 한 단계씩 · 감점 0 범주는 건너뜀 (이전 누르면 거꾸로)', () => {
  const g = new GameEngine();
  g.testAutoComplete('responsible'); // 정직+친환경+불참 → 감점 없음
  assert.equal(g.scoreCategories().length, 0);
  g.reset();
  g.testAutoComplete('allExaggerated');
  goto(g, 'SOCIAL_SCORE_REVEAL');
  const n = g.scoreCategories().length;
  assert.ok(n >= 1 && n <= 3);
  assert.equal(g.state.revealIndex, 0);
  assert.equal(g.displayView(conns).score.categories.length, 0);
  assert.equal(g.adminView().scorePhases.find((p) => p.current).key, 'start');
  for (let i = 0; i < n; i++) g.next('SOCIAL_SCORE_REVEAL', i);
  assert.equal(g.state.revealIndex, n);
  assert.equal(g.displayView(conns).score.done, false);
  assert.equal(g.displayView(conns).score.questions, null);
  assert.throws(() => g.next('SOCIAL_SCORE_REVEAL', n - 1), (e) => e.status === 409); // 늦게 온 같은 클릭은 무시
  g.next('SOCIAL_SCORE_REVEAL', n); // 최종 사회점수 + 발문
  assert.equal(g.state.revealIndex, n + 1);
  const dv = g.displayView(conns).score;
  assert.equal(dv.done, true);
  assert.equal(dv.final, g.socialScore());
  assert.match(dv.questions.main, /왜 돌멩민국의 사회점수는 낮아졌을까요/);
  assert.equal(g.adminView().scorePhases.find((p) => p.current).key, 'final');
  assert.equal(g.adminView().scorePhases.find((p) => p.key === 'consumer').reveal, 1);
  g.next('SOCIAL_SCORE_REVEAL', n + 1);
  assert.equal(g.state.stepId, 'REFLECTION');
  g.prev('REFLECTION');
  assert.equal(g.state.revealIndex, n + 1);
});

test('학생·TV 화면 데이터에 숨은 값이 없음', () => {
  const g = new GameEngine();
  g.testAutoJoin();
  g.testAutoComplete('profitFirst');
  for (const st of STEPS) {
    g.state.stepId = st.id;
    const tv = JSON.stringify(g.teamView(1, conns));
    for (const secret of ['socialEvents', '"score":{', 'variance', 'internal', 'MULTIPLIER', 'seed', 'tokenHash']) {
      assert.ok(!tv.includes(secret), `학생 화면(${st.id})에 ${secret} 포함`);
    }
    const dv = JSON.stringify(g.displayView(conns));
    for (const secret of ['variance', 'internal', 'MULTIPLIER', 'seed', 'tokenHash']) assert.ok(!dv.includes(secret), `TV(${st.id})에 ${secret}`);
    if (st.index < STEPS.find((x) => x.id === 'BLACKOUT').index) {
      assert.ok(!dv.includes('"score":{') && !dv.includes('"news":{') && !dv.includes('"headlines"'), `TV(${st.id})에 사회 영향 데이터가 미리 보임`);
    }
  }
});

test('동률은 공동 순위, 랜덤 없음', () => {
  const g = new GameEngine();
  for (const id of TEAM_IDS) g.state.teams[id].cash = C.STARTING_CASH + (id <= 2 ? 500 : 100);
  const st = g.currentStandings();
  assert.deepEqual(st.map((x) => x.rank), [1, 1, 3, 3, 3]);
  assert.deepEqual(st.map((x) => x.teamId), [1, 2, 3, 4, 5]);
});

test('시장 변동은 세션 동안 고정 (±MARKET_VARIANCE 이내)', () => {
  const g = new GameEngine();
  for (const id of TEAM_IDS) for (let r = 1; r <= 4; r++) {
    assert.ok(Math.abs(g.state.variance[id][r] - 1) <= C.MARKET_VARIANCE + 1e-9);
  }
  const copy = new GameEngine(JSON.parse(JSON.stringify(g.state)));
  assert.deepEqual(copy.state.variance, g.state.variance);
});

test('정리 활동: 원래와 다른 선택만, 1번만 제출', () => {
  const g = new GameEngine();
  g.testAutoComplete('allDifferent');
  goto(g, 'REFLECTION');
  const cur = g.state.teams[1].choices.ad;
  assert.throws(() => g.reflect(1, { target: 'ad', choice: cur, reason: '바꾸고 싶어서' }), /다른 선택지/);
  const other = ['celebrity', 'exaggerated', 'honest'].find((x) => x !== cur);
  g.reflect(1, { target: 'ad', choice: other, reason: '소비자를 생각했기' });
  assert.equal(g.reflect(1, { target: 'price', choice: 5000, reason: '다시' }).already, true);
  assert.equal(g.state.reflections[1].target, 'ad');
});

test('초기화: 새 세션 · 접속 유지 옵션', () => {
  const g = new GameEngine();
  const token = g.claim(1);
  g.testAutoComplete('random');
  const sid = g.state.sessionId;
  g.reset({ keepClaims: true });
  assert.notEqual(g.state.sessionId, sid);
  assert.equal(g.teamIdByToken(token), 1);
  assert.equal(g.state.teams[1].cash, C.STARTING_CASH);
  assert.equal(g.state.socialEvents.length, 0);
  g.reset({ keepClaims: false });
  assert.equal(g.teamIdByToken(token), null);
});

test('이미 선택된 기업은 다른 노트북이 가져갈 수 없음', () => {
  const g = new GameEngine();
  g.claim(2);
  assert.throws(() => g.claim(2), (e) => e.status === 409);
  g.release(2);
  assert.ok(g.claim(2));
});

test('프레젠터(안전 모드): 학생 미제출이면 넘기지 않고 결과도 계산하지 않음', () => {
  const g = new GameEngine();
  g.testAutoJoin();
  goto(g, 'ROUND1_MEETING');
  g.submit(1, { round: 1, choice: 10000, reason: '테스트' }, { byAdmin: true });
  assert.throws(() => g.next('ROUND1_MEETING', null, { safe: true }), (e) => e.status === 423);
  assert.throws(() => g.prev('ROUND1_MEETING', null, { safe: true }), (e) => e.status === 423);
  assert.equal(g.state.stepId, 'ROUND1_MEETING');
  g.next('ROUND1_MEETING'); // 교사 콘솔(강제 진행)은 가능
  assert.equal(g.state.stepId, 'ROUND1_RESPONSES');
  assert.throws(() => g.next('ROUND1_RESPONSES', null, { safe: true }), (e) => e.status === 423);
  assert.equal(g.state.rounds[1], undefined); // 결과 계산 안 됨
  g.prev('ROUND1_RESPONSES', null, { safe: true }); // 뒤로는 가능
  assert.equal(g.state.stepId, 'ROUND1_MEETING');
  g.testAutoSubmit('random');
  g.next('ROUND1_MEETING', null, { safe: true });
  g.next('ROUND1_RESPONSES', null, { safe: true });
  assert.equal(g.state.stepId, 'ROUND1_RESULT');
  assert.ok(g.state.rounds[1].computed);
});

test('프레젠터: 사회적 영향 이후는 자유롭게 앞뒤', () => {
  const g = new GameEngine();
  g.testAutoComplete('profitFirst');
  const at = () => `${g.state.stepId}:${g.state.revealIndex}`;
  const seen = [];
  for (let i = 0; i < 40 && g.state.stepId !== 'REFLECTION'; i++) {
    seen.push(at());
    g.next(g.state.stepId, g.state.revealIndex, { safe: true });
  }
  assert.equal(g.state.stepId, 'REFLECTION');
  assert.ok(seen.includes('NEWS_FAIRNESS:0') && seen.includes('SOCIAL_PAPER:0') && seen.includes('BLACKOUT:0'));
  assert.ok(!seen.includes('NEWS_CONSUMER:1')); // 뉴스 한 기사 = 한 번 클릭
  assert.deepEqual(seen.filter((x) => x.startsWith('SOCIAL_SCORE')), ['SOCIAL_SCORE_REVEAL:0', 'SOCIAL_SCORE_REVEAL:1', 'SOCIAL_SCORE_REVEAL:2', 'SOCIAL_SCORE_REVEAL:3', 'SOCIAL_SCORE_REVEAL:4']);
  assert.throws(() => g.next('REFLECTION', null, { safe: true }), (e) => e.status === 423);
  g.testAutoReflect(); // 정리 활동을 모두 낸 뒤에는 자유롭게 이동
  for (let i = seen.length - 1; i >= 1; i--) {
    g.prev(g.state.stepId, g.state.revealIndex, { safe: true });
    assert.equal(at(), seen[i]);
  }
});

// ── 도입 슬라이드 ───────────────────────────────────────────────────
const lessonAt = (g) => `${g.state.stepId}:${g.state.revealIndex}${g.hintShown() ? ':H' : ''}`;
const DOOR = [
  'LESSON_WAIT:0', 'LESSON_TEST:0', 'LESSON_Q1:0', 'LESSON_Q1:1', 'LESSON_Q2:0', 'LESSON_Q2:1', 'LESSON_Q3:0', 'LESSON_Q3:1',
  'LESSON_PASS:0', 'LESSON_COUNTRY:0', 'LESSON_COMPANIES:0', 'LESSON_MISSION:0', 'LESSON_TOPIC:0', 'LESSON_ACTIVITIES:0',
  'LESSON_ACT1:0', 'LESSON_ACT1_ASK:0', 'LESSON_HOWTO:0', 'INTRO:0', 'ROUND1_SCENE:0',
];

test('도입: 새 세션은 수업 대기 화면 → 다음만으로 ROUND1 까지 (퀴즈는 문제 → 정답), 이전으로 정확히 되돌아감', () => {
  const g = new GameEngine();
  const seen = [lessonAt(g)];
  while (g.state.stepId !== 'ROUND1_SCENE') {
    g.next(g.state.stepId, g.state.revealIndex, { safe: true });
    seen.push(lessonAt(g));
  }
  assert.deepEqual(seen, DOOR);
  for (let i = seen.length - 2; i >= 0; i--) {
    g.prev(g.state.stepId, g.state.revealIndex, { safe: true });
    assert.equal(lessonAt(g), seen[i]);
  }
  // 라운드 계산·돈에는 영향 없음
  assert.deepEqual(g.state.rounds, {});
  assert.ok(Object.values(g.state.teams).every((t) => t.cash === C.STARTING_CASH));
});

test('도입 퀴즈 Q2·Q3: 문제 → 초성 힌트(선택) → 정답 · 이전은 한 단계씩 복원 · 힌트·정답은 공개 전 TV 로 안 보냄', () => {
  const g = new GameEngine();
  g.goto('LESSON_Q2');
  let L = g.displayView().lesson;
  assert.equal(L.phase, 'question');
  assert.equal(L.hints, undefined);
  assert.equal(L.answers, undefined);
  assert.ok(!JSON.stringify(g.displayView()).includes('ㅅㅅ') && !JSON.stringify(g.displayView()).includes('일자리'));
  // 힌트 보이기 (on 지정 → 두 번 보내도 결과 같음)
  g.hint('LESSON_Q2', true);
  g.hint('LESSON_Q2', true);
  L = g.displayView().lesson;
  assert.equal(L.phase, 'hint');
  assert.deepEqual(L.hints, ['ㅅㅅ', 'ㅍㅁ', 'ㅇㅈㄹ']);
  assert.equal(L.answers, undefined);
  assert.equal(g.adminView().quiz.phase, 'hint');
  g.next('LESSON_Q2', 0, { fromHint: true });
  L = g.displayView().lesson;
  assert.equal(L.phase, 'answer');
  assert.deepEqual(L.answers, ['생산', '판매', '일자리']);
  assert.equal(L.hints, undefined);
  g.hint('LESSON_Q2', false); // 정답 공개 뒤에는 힌트 상태를 바꾸지 않음
  assert.equal(g.adminView().quiz.phase, 'answer');
  // 이전: 정답 → 힌트 → 문제 → Q1 정답
  g.prev('LESSON_Q2', 1);
  assert.equal(lessonAt(g), 'LESSON_Q2:0:H');
  assert.equal(g.adminView().prevLabel, '초성 힌트 숨기기');
  g.prev('LESSON_Q2', 0);
  assert.equal(lessonAt(g), 'LESSON_Q2:0');
  g.prev('LESSON_Q2', 0);
  assert.equal(lessonAt(g), 'LESSON_Q1:1');
  // 힌트 없이 바로 정답
  g.goto('LESSON_Q3');
  g.next('LESSON_Q3', 0, { fromHint: false });
  L = g.displayView().lesson;
  assert.equal(L.phase, 'answer');
  assert.deepEqual(L.answers, ['소득', '소비']);
  g.prev('LESSON_Q3', 1);
  assert.equal(lessonAt(g), 'LESSON_Q3:0');
  // 힌트 → 다음 슬라이드 → 돌아오면 정답 화면, 한 번 더 이전이면 힌트 화면 복원
  g.hint('LESSON_Q3', true);
  assert.deepEqual(g.displayView().lesson.hints, ['ㅅㄷ', 'ㅅㅂ']);
  g.next('LESSON_Q3', 0);
  g.next('LESSON_Q3', 1);
  assert.equal(g.state.stepId, 'LESSON_PASS');
  g.prev('LESSON_PASS', 0);
  assert.equal(lessonAt(g), 'LESSON_Q3:1:H');
  g.prev('LESSON_Q3', 1);
  assert.equal(lessonAt(g), 'LESSON_Q3:0:H');
  // 앞에서 다시 들어오면 문제만
  g.goto('LESSON_Q2');
  g.goto('LESSON_Q3');
  assert.equal(lessonAt(g), 'LESSON_Q3:0');
  // TV·교사 콘솔이 같은 힌트 상태에서 동시에 [이전] → 한 단계만
  g.hint('LESSON_Q3', true);
  g.prev('LESSON_Q3', 0, { fromHint: true });
  assert.throws(() => g.prev('LESSON_Q3', 0, { fromHint: true }), (e) => e.status === 409);
  assert.equal(lessonAt(g), 'LESSON_Q3:0');
  // Q1 은 객관식 — 힌트 없음, 정답 ③ + 이윤 = 수입 - 비용
  g.goto('LESSON_Q1');
  assert.throws(() => g.hint('LESSON_Q1'), /Q2·Q3/);
  assert.equal(g.displayView().lesson.answer, undefined);
  assert.equal(g.adminView().nextAction.label, '정답 공개');
  g.next('LESSON_Q1', 0);
  L = g.displayView().lesson;
  assert.equal(L.answer, 3);
  assert.equal(L.choices[L.answer - 1], '물건이나 서비스를 팔아 얻은 수입에서 생산에 들어간 비용을 뺀 금액');
  assert.equal(L.formula, '이윤 = 수입 - 비용');
});

test('도입 중에도 학생은 기업 선택·다시 고르기 가능, 제출은 불가', () => {
  const g = new GameEngine();
  g.goto('LESSON_COMPANIES');
  g.claim(2);
  assert.equal(g.teamView(2).step.kind, 'lesson');
  g.leave(2);
  assert.equal(g.state.teams[2].tokenHash, null);
  assert.throws(() => g.submit(1, { round: 1, choice: 10000, reason: '싸니까요' }), /제출할 수 없습니다/);
  assert.equal(g.displayView().lesson.companies.length, 5);
});

test('재접속 토큰은 해시로만 저장', () => {
  const g = new GameEngine();
  const token = g.claim(3);
  assert.ok(!JSON.stringify(g.state).includes(token));
  assert.equal(g.teamIdByToken(token), 3);
  assert.equal(g.teamIdByToken(`${token}x`), null);
});

console.log(`\n${passed}개 통과${process.exitCode ? ' · 실패 있음' : ''}`);
