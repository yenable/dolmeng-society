// 서버 통합 흐름: 실제 HTTP API 로 한 판 전체를 진행합니다. (smoke-test / db-test 에서 사용)
import assert from 'node:assert/strict';

export const PIN = 'test-pin';

export function client(base) {
  const req = async (method, url, body, headers = {}) => {
    const res = await fetch(base + url, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch { /* html */ }
    return { status: res.status, body: json, text };
  };
  return {
    get: (url, headers) => req('GET', url, null, headers),
    post: (url, body, headers) => req('POST', url, body, headers),
    admin: (action, body = {}) => req('POST', '/api/admin/action', { action, ...body }, { 'x-admin-pin': PIN }),
    adminState: async () => (await req('GET', '/api/state?role=admin', null, { 'x-admin-pin': PIN })).body,
    tv: async () => (await req('GET', '/api/state?role=display')).body,
    me: async (token, clientId = 'test-client') => (await req('GET', '/api/state?role=play', null, { 'x-team-token': token, 'x-client-id': clientId })).body,
  };
}

// restart(): 새 서버 인스턴스(같은 저장소)를 띄우고 base URL 을 돌려줌 — Vercel 의 다른 인스턴스로 요청이 가는 상황
export async function runFlow(base, { restart, log = console.log } = {}) {
  let c = client(base);

  for (const p of ['/', '/play', '/admin', '/display', '/js/play.js', '/js/sfx.js', '/css/display.css']) {
    assert.equal((await c.get(p)).status, 200, p);
  }
  const home = (await c.get('/')).text;
  assert.ok(home.includes('/js/play.js') && !home.includes('어떤 화면으로'), '/ 는 곧바로 학생 화면');
  assert.notEqual((await c.get('/%2e%2e/src/config.js')).status, 200, '경로 탈출 차단');
  log('  ✓ / = 학생 화면 · /admin · /display · 정적 파일');

  assert.equal((await c.post('/api/admin/action', { action: 'next' }, { 'x-admin-pin': 'wrong' })).status, 401);
  assert.equal((await c.get('/api/state?role=admin', { 'x-admin-pin': 'wrong' })).status, 401);
  assert.equal((await c.post('/api/admin/login', {}, { 'x-admin-pin': PIN })).status, 200);
  const cfg = (await c.get('/api/config')).text;
  assert.ok(!/service|SERVICE/.test(cfg), '설정 API 에 서버 전용 키 없음');
  log('  ✓ 교사 PIN 없으면 진행·조회 불가 · 서버 키 비공개');

  await c.admin('reset', { keepClaims: false });
  const tokens = {};
  for (const id of [1, 2, 3, 4, 5]) {
    const r = await c.post('/api/play/claim', { teamId: id });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    tokens[id] = r.body.token;
  }
  assert.equal((await c.post('/api/play/claim', { teamId: 1 })).status, 409);
  const s0 = await c.me(tokens[1]);
  assert.equal(s0.me.name, '말랑컴퍼니');
  assert.equal(s0.me.cash, 1_000_000);
  assert.equal(s0.tokenRejected, false);
  assert.equal((await c.me('not-a-real-token')).tokenRejected, true);
  const adm0 = await c.adminState();
  assert.equal(adm0.teams.find((t) => t.id === 1).connections, 1, '학생 접속 표시(하트비트)');
  log('  ✓ 5개 기업 접속 · 중복 선택 차단 · 접속 표시');

  // 프레젠터 안전: 회의 중 미제출이면 넘어가지 않음
  await c.admin('goto', { stepId: 'ROUND1_MEETING' });
  const blocked = await c.admin('next', { presenter: true, from: 'ROUND1_MEETING' });
  assert.equal(blocked.status, 423);
  assert.match(blocked.body.error, /결정 중인 기업/);
  assert.equal((await c.tv()).step.id, 'ROUND1_MEETING');
  log('  ✓ 프레젠터: 학생 미제출 회의 단계는 넘기지 않음 (423)');

  const choices = { 1: [10000, 'exaggerated', 'cheap', 'join'], 2: [10000, 'celebrity', 'normal', 'join'], 3: [15000, 'honest', 'eco', 'join'], 4: [5000, 'exaggerated', 'normal', 'join'], 5: [20000, 'honest', 'eco', 'no'] };
  for (let r = 1; r <= 4; r++) {
    await c.admin('goto', { stepId: `ROUND${r}_MEETING` });
    for (const id of [1, 2, 3, 4]) {
      const res = await c.post('/api/play/submit', { token: tokens[id], round: r, choice: choices[id][r - 1], reason: '모둠에서 이야기한 이유', prediction: 'most' });
      assert.equal(res.status, 200, JSON.stringify(res.body));
    }
    const dup = await c.post('/api/play/submit', { token: tokens[1], round: r, choice: choices[1][r - 1], reason: '다시', prediction: 'most' });
    assert.equal(dup.body.already, true);
    if (r !== 2) await c.admin('submitFor', { teamId: 5, round: r, choice: choices[5][r - 1], reason: '선생님 입력', prediction: 'few' });
    // 버튼 연타: 같은 화면에서 보낸 [다음] 두 번
    const [ra, rb] = await Promise.all([c.admin('next', { from: `ROUND${r}_MEETING` }), c.admin('next', { from: `ROUND${r}_MEETING` })]);
    assert.deepEqual([ra.status, rb.status].sort(), [200, 409]);
    let assign;
    if (r === 2) {
      // 미제출 기업이 있으면 자동 기본값(광고 안 함 등) 없이 멈춤 → 교사가 선택을 지정해야 계산
      const miss = await c.admin('next', { from: 'ROUND2_RESPONSES' });
      assert.equal(miss.status, 409);
      assert.match(miss.body.error, /젤리팩토리가 아직 광고 방법을 선택하지 않았습니다\. 강제 진행하려면 교사 대신 선택을 지정해 주세요/);
      const adm = await c.adminState();
      assert.equal(adm.rounds[2].computed, false);
      assert.deepEqual(adm.nextAction.assign, { round: 2, teamIds: [5] });
      assign = { 5: choices[5][1] };
    }
    // 결과 계산 버튼을 동시에 5번 (교사 콘솔 + TV 키보드 + 재시도)
    const many = await Promise.all(Array.from({ length: 5 }, (_, i) => c.admin('next', { from: `ROUND${r}_RESPONSES`, presenter: i % 2 === 1, assign })));
    assert.equal(many.filter((x) => x.status === 200).length, 1, `라운드 ${r} 결과 계산은 한 번만: ${many.map((x) => x.status)}`);
    const tv = await c.tv();
    assert.equal(tv.step.id, `ROUND${r}_RESULT`);
    assert.equal(tv.results.length, 5);
  }
  const assigned = (await c.adminState()).submissions[2][5];
  assert.equal(assigned.choice, 'honest');
  assert.equal(assigned.byAdmin, true);
  assert.equal(assigned.byDefault, false);
  const before = await c.adminState();
  await c.admin('goto', { stepId: 'ROUND2_RESULT' });
  await c.admin('goto', { stepId: 'ROUND4_RESULT' });
  await c.admin('next', { from: 'ROUND4_RESULT' });
  await c.admin('prev', { from: 'FINAL_PROFIT' });
  const after = await c.adminState();
  assert.deepEqual(after.teams.map((t) => t.cash), before.teams.map((t) => t.cash));
  log('  ✓ 4라운드 진행 · 대신 제출 · 미제출이면 계산 안 함(교사 지정 후 진행) · 연타/동시 요청에도 결과는 정확히 1번 · 재진입해도 재계산 없음');

  // 학생 재접속: 다른 서버 인스턴스로 요청이 가도 같은 기업·돈 그대로
  const mine = await c.me(tokens[1]);
  if (restart) {
    c = client(await restart());
    const again = await c.me(tokens[1]);
    assert.equal(again.me.id, 1);
    assert.equal(again.me.cash, mine.me.cash);
    assert.equal(again.step.id, mine.step.id);
    log('  ✓ 서버 인스턴스가 바뀌어도(재시작) 같은 상태 · 학생 토큰 유지');
  }

  // 사회점수: 과장2(-40) 일반2(-20) 절감1(-20) 담합4(-30) = -10
  assert.equal(after.social.score, -10);
  const tvBefore = JSON.stringify(await c.tv());
  assert.ok(!tvBefore.includes('"score":{'));
  await c.admin('goto', { stepId: 'NEWS_CONSUMER' });
  const news = await c.tv();
  assert.match(news.news.lines[0], /말랑컴퍼니와 쫀득상사가/); // 제목·기사 함께 전달 → TV 가 제목 타이핑 후 자동으로 기사 표시
  assert.equal(news.reveal, undefined);
  await c.admin('next', { from: 'NEWS_CONSUMER', presenter: true }); // 다음 클릭 = 다음 기사
  assert.equal((await c.tv()).step.id, 'NEWS_ENVIRONMENT');
  await c.admin('goto', { stepId: 'SOCIAL_PAPER' });
  assert.equal((await c.tv()).headlines.length, 3);
  await c.admin('goto', { stepId: 'SOCIAL_SCORE_REVEAL' });
  let tv = await c.tv();
  assert.equal(tv.score.categories.length, 0);
  assert.equal(tv.score.total, 3);
  const path = [tv.score.start];
  for (let i = 0; i <= tv.score.total; i++) {
    const r = await c.admin('next', { from: 'SOCIAL_SCORE_REVEAL', fromReveal: i, presenter: true });
    assert.equal(r.status, 200);
    tv = await c.tv();
    if (!tv.score.done) path.push(tv.score.categories.at(-1).after);
  }
  assert.deepEqual(path, [100, 60, 20, -10]); // 소비자(과장 2) -40 · 환경(일반 2, 절감 1) -40 · 공정(4곳) -30
  assert.equal(tv.score.final, -10);
  assert.equal(tv.score.done, true);
  assert.match(tv.score.questions.main, /사회점수는 낮아졌을까요/);
  log('  ✓ 뉴스(제목→내용 자동, 기사마다 한 클릭) · 사회면 · 사회점수 범주별 공개 → 최종(음수) + 발문');

  await c.admin('next', { from: 'SOCIAL_SCORE_REVEAL', fromReveal: tv.score.total + 1 });
  // 사회적 책임 도입 발문 → 개념 정리 → 자유 + 책임 정리 → 정리 활동
  for (const id of ['CSR_ASK', 'CSR_CONCEPT', 'CSR_SUMMARY']) {
    tv = await c.tv();
    assert.equal(tv.step.id, id);
    assert.equal(tv.step.kind, 'concept');
    assert.ok(tv.concept?.title || tv.concept?.left);
    assert.equal((await c.admin('next', { from: id, presenter: true })).status, 200);
  }
  assert.equal((await c.tv()).step.id, 'REFLECTION');
  const r1 = await c.post('/api/play/reflect', { token: tokens[1], target: 'ad', choice: 'honest', reason: '소비자에게 피해를 줄 수 있기' });
  assert.equal(r1.status, 200, JSON.stringify(r1.body));
  assert.equal((await c.admin('next', { from: 'REFLECTION', presenter: true })).status, 423);
  await c.admin('testAutoReflect');
  await c.admin('next', { from: 'REFLECTION', presenter: true });
  tv = await c.tv();
  assert.equal(tv.reflections.filter((x) => x.submitted).length, 5);
  log('  ✓ 정리 활동 제출 · TV 공개');

  // 연결 해제 → 그 학생만 토큰 무효
  await c.admin('release', { teamId: 5 });
  assert.equal((await c.me(tokens[5])).tokenRejected, true);
  assert.equal((await c.me(tokens[4])).tokenRejected, false);

  // 전체 초기화 (접속 유지)
  const sid = (await c.adminState()).sessionId;
  await c.admin('reset', { keepClaims: true });
  const kept = await c.me(tokens[2]);
  assert.notEqual(kept.sessionId, sid);
  assert.equal(kept.me.id, 2);
  assert.equal(kept.me.cash, 1_000_000);
  const fresh = await c.adminState();
  assert.equal(fresh.social.score, 100);
  assert.equal(fresh.step.id, 'LESSON_WAIT'); // 새 세션은 도입(수업 대기 화면)부터
  // 전체 초기화 (접속도 초기화)
  await c.admin('reset', { keepClaims: false });
  assert.equal((await c.me(tokens[2])).tokenRejected, true);
  log('  ✓ 연결 해제 · 전체 초기화(새 세션, 100만원, 사회점수 100, 이전 토큰 처리)');
  return { tokens };
}
