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
const goto = (g, id) => g.goto(id);
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
  g.next('INTRO');
  assert.equal(g.state.stepId, 'ROUND1_SCENE');
  assert.throws(() => g.next('INTRO'), (e) => e.status === 409);
  assert.equal(g.state.stepId, 'ROUND1_SCENE');
});

test('미제출 모둠은 기본값으로 계산되고 게임이 멈추지 않음', () => {
  const g = new GameEngine();
  goto(g, 'FINAL_PROFIT');
  for (let r = 1; r <= 4; r++) assert.ok(g.state.rounds[r].computed);
  assert.equal(g.state.submissions[1][1].byDefault, true);
  assert.equal(g.state.teams[1].choices.ad, 'none');
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

test('사회점수: 과장광고·생산·담합 누적, 음수까지 내려감', () => {
  const g = new GameEngine();
  g.testAutoJoin();
  g.testAutoComplete('profitFirst');
  // 과장 -20×5, 비용절감 -20×5, 담합 5곳 -30 → 100 - 230 = -130
  assert.equal(g.socialScore(), -130);
  const items = g.scoreItems();
  assert.equal(items.length, 11);
  assert.equal(items.at(-1).after, -130);
  assert.equal(items.at(-1).category, 'fairness');
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
  assert.equal(g.state.revealIndex, 0); // 제목 장면
  assert.equal(g.displayView(conns).news.lines.length, 0); // 기사 내용은 아직
  g.next('NEWS_CONSUMER', 0);
  assert.equal(g.state.stepId, 'NEWS_CONSUMER');
  assert.ok(g.displayView(conns).news.lines.length > 0); // 다음 클릭에 기사 내용
  g.next('NEWS_CONSUMER', 1);
  assert.equal(g.state.stepId, 'SOCIAL_PAPER'); // 환경·공정 뉴스 건너뜀
  assert.ok(g.displayView(conns).headlines.length >= 1);
  g.prev('SOCIAL_PAPER');
  assert.deepEqual([g.state.stepId, g.state.revealIndex], ['NEWS_CONSUMER', 1]); // 뒤로 오면 기사까지 보임
  assert.equal(g.socialScore(), 60);
});

test('사회점수 공개는 항목별로 한 단계씩 (이전 누르면 거꾸로)', () => {
  const g = new GameEngine();
  g.testAutoComplete('allExaggerated');
  goto(g, 'SOCIAL_SCORE_REVEAL');
  const n = g.scoreItems().length;
  assert.equal(g.state.revealIndex, 0);
  for (let i = 0; i < n; i++) g.next('SOCIAL_SCORE_REVEAL', i);
  assert.equal(g.state.revealIndex, n);
  assert.equal(g.displayView(conns).score.done, false);
  assert.throws(() => g.next('SOCIAL_SCORE_REVEAL', n - 1), (e) => e.status === 409); // 늦게 온 같은 클릭은 무시
  g.next('SOCIAL_SCORE_REVEAL', n); // 최종 사회점수 장면
  assert.equal(g.state.revealIndex, n + 1);
  assert.equal(g.displayView(conns).score.done, true);
  assert.equal(g.displayView(conns).score.items.length, n);
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
  assert.ok(seen.includes('NEWS_FAIRNESS:1') && seen.includes('SOCIAL_PAPER:0') && seen.includes('BLACKOUT:0'));
  assert.throws(() => g.next('REFLECTION', null, { safe: true }), (e) => e.status === 423);
  g.testAutoReflect(); // 정리 활동을 모두 낸 뒤에는 자유롭게 이동
  for (let i = seen.length - 1; i >= 1; i--) {
    g.prev(g.state.stepId, g.state.revealIndex, { safe: true });
    assert.equal(at(), seen[i]);
  }
});

test('재접속 토큰은 해시로만 저장', () => {
  const g = new GameEngine();
  const token = g.claim(3);
  assert.ok(!JSON.stringify(g.state).includes(token));
  assert.equal(g.teamIdByToken(token), 3);
  assert.equal(g.teamIdByToken(`${token}x`), null);
});

console.log(`\n${passed}개 통과${process.exitCode ? ' · 실패 있음' : ''}`);
