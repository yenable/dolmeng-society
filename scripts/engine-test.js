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
  assert.equal(g.state.stepId, 'CSR_ASK'); // 최종 발문 → 사회적 책임 도입 발문
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
  assert.equal(g.state.stepId, 'ACT1_FREEDOM'); // 기업의 자유 정리 → 활동 2 발문 → 하지만…
  g.next('ACT1_FREEDOM');
  g.next('ACT2_ASK');
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
  assert.equal(g.state.stepId, 'CSR_ASK');
  g.prev('CSR_ASK');
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
  'LESSON_WAIT:0', 'LESSON_COUNTRY:0', 'LESSON_TEST:0', 'LESSON_Q1:0', 'LESSON_Q1:1', 'LESSON_Q2:0', 'LESSON_Q2:1', 'LESSON_Q3:0', 'LESSON_Q3:1',
  'LESSON_PASS:0', 'LESSON_COMPANIES:0', 'LESSON_MISSION:0', 'LESSON_TOPIC:0', 'LESSON_ACTIVITIES:0',
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

// ── 활동 1 정리 · 활동 2 (기업의 자유 → 사회적 영향 → 사회적 책임) ─────────────────
test('활동 1 → 2: 최종 이윤 순위 → 기업의 자유 → 활동 2 발문 → 하지만… → 뉴스 → 사회점수 → 사회적 책임 3장 → 정리 (이전은 거꾸로)', () => {
  const g = new GameEngine();
  g.testAutoComplete('profitFirst');
  const at = () => `${g.state.stepId}:${g.state.revealIndex}`;
  const seen = [at()];
  while (g.state.stepId !== 'REFLECTION') {
    g.next(g.state.stepId, g.state.revealIndex, { safe: true });
    seen.push(at());
  }
  assert.deepEqual(seen, [
    'FINAL_PROFIT:0', 'ACT1_FREEDOM:0', 'ACT2_ASK:0', 'BLACKOUT:0',
    'NEWS_CONSUMER:0', 'NEWS_ENVIRONMENT:0', 'NEWS_FAIRNESS:0', 'SOCIAL_PAPER:0',
    'SOCIAL_SCORE_REVEAL:0', 'SOCIAL_SCORE_REVEAL:1', 'SOCIAL_SCORE_REVEAL:2', 'SOCIAL_SCORE_REVEAL:3', 'SOCIAL_SCORE_REVEAL:4',
    'CSR_ASK:0', 'CSR_CONCEPT:0', 'CSR_SUMMARY:0', 'REFLECTION:0',
  ]);
  for (let i = seen.length - 2; i >= 0; i--) {
    g.prev(g.state.stepId, g.state.revealIndex);
    assert.equal(at(), seen[i]);
  }
  // 슬라이드 내용
  const slide = (id) => {
    g.goto(id);
    return g.displayView(conns);
  };
  const fr = slide('ACT1_FREEDOM');
  assert.equal(fr.step.kind, 'concept');
  assert.equal(fr.concept.title, '기업은 어떻게 경제활동을 할까요?');
  assert.deepEqual(fr.concept.keywords.map((k) => k.label), ['생산 방법', '가격', '광고 방법']);
  assert.equal(fr.concept.key, '기업은 자신의 판단에 따라 자유롭게 경제활동을 할 수 있습니다.');
  assert.ok(!fr.score && !fr.news && !fr.headlines, '기업의 자유 화면에 사회적 영향 데이터 없음');
  const a2 = slide('ACT2_ASK').concept;
  assert.deepEqual(Object.keys(a2), ['ask', 'sub'], '활동 2 라벨·제목 없이 발문만');
  assert.equal(a2.ask.join(' '), '지금 결과만 본다면, 어떤 기업이 가장 잘 운영했다고 생각하나요?');
  assert.equal(a2.sub, '그렇게 생각한 까닭은 무엇인가요?');
  const ask = JSON.stringify(slide('CSR_ASK').concept);
  assert.match(ask, /함께 생각해야 할 것은 무엇일까요\?/);
  assert.doesNotMatch(ask, /소비자에게 피해|공정하게 경쟁해야/, '예상 답변은 TV 에 보내지 않음');
  const csr = slide('CSR_CONCEPT').concept;
  assert.equal(csr.title, '기업의 사회적 책임');
  assert.deepEqual(csr.cards.map((c) => `${c.label}:${c.desc}`), ['소비자:정확한 정보를 제공하기', '환경:환경을 생각하며 생산하기', '공정 경쟁:다른 기업과 공정하게 경쟁하기']);
  assert.equal(slide('CSR_SUMMARY').concept.key, '자유롭게 선택하되, 그 선택의 영향도 생각하기');
  // 학생 화면: 새 슬라이드 동안 별도 데이터 없음 (기존처럼 'TV 화면을 함께 봐요')
  g.testAutoJoin();
  for (const id of ['ACT1_FREEDOM', 'ACT2_ASK', 'CSR_ASK', 'CSR_CONCEPT', 'CSR_SUMMARY']) {
    g.goto(id);
    const tv = g.teamView(1, conns);
    assert.ok(!tv.concept && !tv.reflection && !tv.standings && !tv.canSubmit, id);
  }
  // 새 단계도 이미 계산된 라운드를 다시 계산하지 않음
  const before = JSON.stringify(g.state.rounds);
  g.goto('ACT1_FREEDOM');
  g.goto('CSR_SUMMARY');
  assert.equal(JSON.stringify(g.state.rounds), before);
});

test('담합: 활동 1(학생·TV)에는 용어 없음 → 공정 경쟁 뉴스에서 처음 뜻과 함께 제시 (참여 기업 수·이름은 실제 데이터)', () => {
  const g = new GameEngine();
  g.testAutoJoin();
  goto(g, 'ROUND4_MEETING');
  submitAll(g, 4, ['join', 'no', 'join', 'join', 'no']);
  const fairIdx = STEPS.find((s) => s.id === 'NEWS_FAIRNESS').index;
  for (const st of STEPS.filter((s) => s.index < fairIdx)) {
    g.state.stepId = st.id;
    for (const id of TEAM_IDS) assert.doesNotMatch(JSON.stringify(g.teamView(id, conns)), /담합/, `학생 화면(${st.id})`);
    if (g.state.rounds[4]?.computed || st.index < STEPS.find((s) => s.id === 'ROUND4_RESULT').index) {
      assert.doesNotMatch(JSON.stringify(g.displayView(conns)), /담합/, `TV(${st.id})`);
    }
    if (st.id === 'ROUND4_RESPONSES') g.computeRound(4);
  }
  g.goto('NEWS_FAIRNESS');
  const n = g.displayView(conns).news;
  assert.equal(n.headline, '슬랑이 기업들, 가격 함께 올려… 소비자 부담 커져');
  assert.equal(n.lines[0], '말랑컴퍼니, 몽글기업, 쫀득상사 3곳이 약속하여 슬랑이 가격을 30,000원 이상으로 함께 올린 사실이 알려졌습니다.');
  assert.equal(n.lines.length, 3);
  assert.match(n.lines[1], /기업들이 서로 짜고 가격이나 거래 조건을 정하는 것을 ‘담합’이라고/);
  assert.match(n.lines[2], /^담합이 이루어지면 소비자는 더 비싼 가격에 상품을 사게 되고, 공정한 경쟁도 어려워집니다/);
  assert.deepEqual(n.concept, { term: '담합', desc: '기업들이 서로 짜고 가격이나 거래 조건을 정하는 것' });
  assert.deepEqual(n.companies.map((c) => c.id), [1, 3, 4]);
  // 5곳 모두 참여
  const all = new GameEngine();
  goto(all, 'ROUND4_MEETING');
  submitAll(all, 4, ['join', 'join', 'join', 'join', 'join']);
  goto(all, 'NEWS_FAIRNESS');
  assert.equal(all.news().fairness.headline, '슬랑이 기업 5곳, 가격 함께 올려… 싼 슬랑이 사라져');
  assert.match(all.news().fairness.lines[0], /^슬랑이 기업 5곳이 모두 약속하여/);
  assert.equal(all.news().fairness.companies.length, 5);
});

// ── 기업 회의 타이머 ─────────────────────────────────────────────
test('회의 타이머: 회의 단계에 앞으로 들어오면 2분 자동 시작 · 세 화면이 같은 값 · 회의가 아니면 없음', () => {
  const g = new GameEngine();
  g.testAutoJoin();
  for (let r = 1; r <= 4; r++) {
    goto(g, `ROUND${r}_SCENE`);
    assert.equal(g.displayView(conns).timer, null);
    g.next(`ROUND${r}_SCENE`);
    assert.equal(g.state.stepId, `ROUND${r}_MEETING`);
    const tv = g.displayView(conns).timer;
    assert.ok(tv && !tv.paused && tv.leftMs > C.MEETING_TIMER_MS - 1000 && tv.leftMs <= C.MEETING_TIMER_MS, `${r}라운드 2분`);
    assert.ok(Math.abs(g.teamView(1, conns).timer.leftMs - tv.leftMs) < 50);
    assert.ok(Math.abs(g.adminView(conns).timer.leftMs - tv.leftMs) < 50);
    g.testAutoSubmit('random', r);
    g.next(`ROUND${r}_MEETING`);
    assert.equal(g.displayView(conns).timer, null, '선택 공개 단계에는 타이머 없음');
    assert.equal(g.adminView(conns).timer, null);
  }
});

test('회의 타이머: ±30초·±1분 · 0 아래로 내려가지 않음 · 일시정지/다시 시작 · 2분 초기화 · 0초여도 자동 제출 없음', () => {
  const g = new GameEngine();
  g.testAutoJoin();
  goto(g, 'ROUND2_MEETING');
  const left = () => g.adminView(conns).timer.leftMs;
  const near = (ms) => assert.ok(Math.abs(left() - ms) < 300, `${left()} ≈ ${ms}`);
  g.timer('ROUND2_MEETING', 'add', 30); near(150_000);
  g.timer('ROUND2_MEETING', 'add', 60); near(210_000);
  g.timer('ROUND2_MEETING', 'add', -60); near(150_000);
  g.timer('ROUND2_MEETING', 'add', -30); near(120_000);
  g.timer('ROUND2_MEETING', 'pause');
  assert.equal(g.adminView(conns).timer.paused, true);
  const p = left();
  g.timer('ROUND2_MEETING', 'add', -30); assert.equal(left(), p - 30_000);
  g.timer('ROUND2_MEETING', 'resume'); assert.equal(g.adminView(conns).timer.paused, false); near(p - 30_000);
  for (let i = 0; i < 5; i++) g.timer('ROUND2_MEETING', 'add', -60);
  assert.equal(left(), 0);
  // 시간이 끝나도 제출·진행은 그대로 (교사가 넘길 때까지 00:00 유지)
  g.state.timer.endsAt = Date.now() - 60_000;
  assert.equal(left(), 0);
  assert.equal(Object.keys(g.state.submissions[2]).length, 0);
  assert.equal(g.state.stepId, 'ROUND2_MEETING');
  g.submit(1, { round: 2, choice: 'honest', reason: '시간이 지나도 제출 가능' });
  g.timer('ROUND2_MEETING', 'add', 30); near(30_000);
  g.timer('ROUND2_MEETING', 'reset'); near(120_000);
  assert.throws(() => g.timer('ROUND1_MEETING', 'add', 30), /이미 다른 단계/);
  g.testAutoSubmit('random', 2);
  g.next('ROUND2_MEETING');
  assert.throws(() => g.timer('ROUND2_RESPONSES', 'add', 30), /기업 회의 중에만/);
});

test('회의 타이머: 저장(JSON) 후 다시 읽어도 남은 시간 유지 · 뒤로 돌아오면 이어서, 앞으로 다시 들어오면 새로 2분', () => {
  const g = new GameEngine();
  g.testAutoJoin();
  goto(g, 'ROUND3_MEETING');
  g.timer('ROUND3_MEETING', 'add', -60);
  const again = new GameEngine(JSON.parse(JSON.stringify(g.state)));
  assert.ok(Math.abs(again.displayView(conns).timer.leftMs - 60_000) < 300);
  g.testAutoSubmit('random', 3);
  g.next('ROUND3_MEETING');
  // 회의를 떠나면 남은 시간이 그 자리에서 멈춤 (선택 공개 화면에 오래 있어도 줄지 않음)
  assert.equal(g.state.timer.held, true);
  assert.ok(Math.abs(g.state.timer.pausedLeft - 60_000) < 300);
  g.state.timer.endsAt = Date.now() - 999_000; // 흐르는 시계였다면 0이 됐을 상황
  g.prev('ROUND3_RESPONSES');
  const back = g.adminView(conns).timer;
  assert.ok(!back.paused && Math.abs(back.leftMs - 60_000) < 300, '뒤로: 떠날 때 남은 시간부터 이어서');
  // 교사가 일시정지해 둔 채 떠났다가 돌아오면 일시정지 그대로
  g.timer('ROUND3_MEETING', 'pause');
  g.next('ROUND3_MEETING');
  g.prev('ROUND3_RESPONSES');
  assert.equal(g.adminView(conns).timer.paused, true);
  g.prev('ROUND3_MEETING');
  g.next('ROUND3_SCENE');
  const fresh = g.adminView(conns).timer;
  assert.ok(!fresh.paused && fresh.leftMs > 119_000, '앞으로: 새로 2분');
  // 다음 라운드까지 간 뒤 지난 라운드 회의로 돌아가면: 결과가 나온 라운드라 잠김 → 타이머 없음
  goto(g, 'ROUND4_MEETING');
  assert.ok(g.adminView(conns).timer.leftMs > 119_000, '4라운드 회의: 새로 2분');
  g.goto('ROUND3_MEETING');
  assert.equal(g.adminView(conns).timer, null);
  assert.equal(g.adminView(conns).timerStartable, false);
});

test('회의 타이머: 한 기업이 먼저 제출해도 전체 회의 시간은 그대로 · 타이머 없는 예전 세션도 교사가 시작 가능', () => {
  const g = new GameEngine();
  g.testAutoJoin();
  goto(g, 'ROUND1_MEETING');
  g.timer('ROUND1_MEETING', 'add', -30);
  g.submit(2, { round: 1, choice: 10000, reason: '먼저 정했기' });
  assert.ok(Math.abs(g.teamView(2, conns).timer.leftMs - 90_000) < 300, '제출한 기업 화면에도 같은 시간');
  assert.ok(Math.abs(g.teamView(3, conns).timer.leftMs - 90_000) < 300);
  assert.ok(Math.abs(g.displayView(conns).timer.leftMs - 90_000) < 300);
  // 타이머 기능 전에 이미 회의 단계였던 세션 (state.timer 없음)
  const old = JSON.parse(JSON.stringify(g.state));
  delete old.timer;
  const legacy = new GameEngine(old);
  assert.equal(legacy.adminView(conns).timer, null);
  assert.equal(legacy.adminView(conns).timerStartable, true);
  legacy.timer('ROUND1_MEETING', 'reset');
  assert.ok(legacy.displayView(conns).timer.leftMs > 119_000);
  assert.equal(legacy.adminView(conns).timerStartable, false);
});

test('재접속 토큰은 해시로만 저장', () => {
  const g = new GameEngine();
  const token = g.claim(3);
  assert.ok(!JSON.stringify(g.state).includes(token));
  assert.equal(g.teamIdByToken(token), 3);
  assert.equal(g.teamIdByToken(`${token}x`), null);
});

console.log(`\n${passed}개 통과${process.exitCode ? ' · 실패 있음' : ''}`);
