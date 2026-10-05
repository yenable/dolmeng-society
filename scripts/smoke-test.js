// 서버 통합 테스트: 실제 서버를 띄워 HTTP/SSE로 한 판 전체를 진행합니다.
// node scripts/smoke-test.js
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 3990 + Math.floor(Math.random() * 9);
const BASE = `http://127.0.0.1:${PORT}`;
const PIN = 'test-pin';
const DATA = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'slangi-')), 'state.json');

function startServer() {
  const p = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), ADMIN_PIN: PIN, DATA_FILE: DATA }, stdio: ['ignore', 'pipe', 'pipe'] });
  p.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));
  return new Promise((resolve) => p.stdout.on('data', (d) => { if (String(d).includes('서버가 켜졌습니다')) resolve(p); }));
}
const post = async (url, body, headers = {}) => {
  const res = await fetch(BASE + url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};
const admin = (action, body = {}) => post('/api/admin/action', { action, ...body }, { 'x-admin-pin': PIN });

// SSE 에서 첫 상태 하나 받기
async function firstState(query) {
  const ctrl = new AbortController();
  const res = await fetch(`${BASE}/events?${query}`, { signal: ctrl.signal });
  const reader = res.body.getReader();
  let buf = '';
  for (;;) {
    const { value } = await reader.read();
    buf += new TextDecoder().decode(value);
    const m = buf.match(/event: state\ndata: (.*)\n\n/);
    if (m) {
      ctrl.abort();
      return JSON.parse(m[1]);
    }
  }
}

let server = await startServer();
try {
  console.log('서버 통합 테스트');
  // 페이지
  for (const p of ['/', '/play', '/admin', '/display', '/js/play.js', '/css/display.css']) {
    const r = await fetch(BASE + p);
    assert.equal(r.status, 200, p);
  }
  assert.notEqual((await fetch(`${BASE}/%2e%2e/src/config.js`)).status, 200, '경로 탈출 차단');
  console.log('  ✓ 화면 3종 + 정적 파일');

  // 권한
  assert.equal((await post('/api/admin/action', { action: 'next' }, { 'x-admin-pin': 'wrong' })).status, 401);
  assert.equal((await fetch(`${BASE}/events?role=admin&pin=wrong`)).status, 401);
  console.log('  ✓ 교사 PIN 없으면 진행 불가');

  // 5모둠 접속
  const tokens = {};
  for (const id of [1, 2, 3, 4, 5]) {
    const r = await post('/api/play/claim', { teamId: id });
    assert.equal(r.status, 200);
    tokens[id] = r.body.token;
  }
  assert.equal((await post('/api/play/claim', { teamId: 1 })).status, 409);
  const s0 = await firstState(`role=play&token=${tokens[1]}`);
  assert.equal(s0.me.name, '말랑컴퍼니');
  assert.equal(s0.me.cash, 1_000_000);
  console.log('  ✓ 5개 기업 접속 · 중복 선택 차단 · 실시간 상태 수신');

  // 한 판 진행
  const choices = { 1: [10000, 'exaggerated', 'cheap', 'join'], 2: [10000, 'celebrity', 'normal', 'join'], 3: [15000, 'honest', 'eco', 'join'], 4: [5000, 'exaggerated', 'normal', 'join'], 5: [20000, 'honest', 'eco', 'no'] };
  const step = async () => (await firstState(`role=admin&pin=${PIN}`)).step.id;
  for (let r = 1; r <= 4; r++) {
    await admin('goto', { stepId: `ROUND${r}_MEETING` });
    for (const id of [1, 2, 3, 4]) {
      const res = await post('/api/play/submit', { token: tokens[id], round: r, choice: choices[id][r - 1], reason: '모둠에서 이야기한 이유', prediction: 'most' });
      assert.equal(res.status, 200, JSON.stringify(res.body));
    }
    // 연타: 같은 제출 두 번
    const dup = await post('/api/play/submit', { token: tokens[1], round: r, choice: choices[1][r - 1], reason: '다시', prediction: 'most' });
    assert.equal(dup.body.already, true);
    // 5모둠은 교사가 대신 제출
    await admin('submitFor', { teamId: 5, round: r, choice: choices[5][r - 1], reason: '선생님 입력', prediction: 'few' });
    const from = await step();
    const a = admin('next', { from });
    const b = admin('next', { from }); // 버튼 연타
    const [ra, rb] = await Promise.all([a, b]);
    assert.deepEqual([ra.status, rb.status].sort(), [200, 409]);
    await admin('next', { from: `ROUND${r}_RESPONSES` }); // 결과 계산
    const tv = await firstState('role=display');
    assert.equal(tv.step.id, `ROUND${r}_RESULT`);
    assert.equal(tv.results.length, 5);
  }
  const before = await firstState(`role=admin&pin=${PIN}`);
  await admin('goto', { stepId: 'ROUND4_RESULT' });
  const after = await firstState(`role=admin&pin=${PIN}`);
  assert.deepEqual(after.teams.map((t) => t.cash), before.teams.map((t) => t.cash));
  console.log('  ✓ 4라운드 진행 · 대신 제출 · 연타 무시 · 재진입해도 재계산 없음');

  // 사회점수: 과장2(-40) 일반2(-20) 절감1(-20) 담합4(-30) = -10
  assert.equal(after.social.score, -10);
  const tvBefore = JSON.stringify(await firstState('role=display'));
  assert.ok(!tvBefore.includes('"score":{'));
  await admin('goto', { stepId: 'NEWS_CONSUMER' });
  const news = await firstState('role=display');
  assert.match(news.news.lines[0], /말랑컴퍼니와 쫀득상사가/);
  await admin('goto', { stepId: 'SOCIAL_VIDEO' });
  const vid = await firstState('role=display');
  assert.equal(vid.video.available, fs.existsSync(path.join(ROOT, 'public/videos/social-impact.mp4')));
  await admin('goto', { stepId: 'SOCIAL_SCORE_REVEAL' });
  let tv = await firstState('role=display');
  assert.equal(tv.score.items.length, 0);
  for (let i = 0; i < tv.score.total; i++) await admin('next', { from: 'SOCIAL_SCORE_REVEAL', fromReveal: i });
  tv = await firstState('role=display');
  assert.equal(tv.score.items.at(-1).after, -10);
  console.log('  ✓ 뉴스 · 영상 슬롯 · 사회점수 순차 공개(음수)');

  // 정리
  await admin('goto', { stepId: 'REFLECTION' });
  const r1 = await post('/api/play/reflect', { token: tokens[1], target: 'ad', choice: 'honest', reason: '소비자에게 피해를 줄 수 있기' });
  assert.equal(r1.status, 200, JSON.stringify(r1.body));
  await admin('testAutoReflect');
  await admin('next', { from: 'REFLECTION' });
  tv = await firstState('role=display');
  assert.equal(tv.reflections.filter((x) => x.submitted).length, 5);
  console.log('  ✓ 정리 활동 제출 · TV 공개');

  // 서버 재시작 후 복구
  const snap = await firstState(`role=admin&pin=${PIN}`);
  server.kill();
  await new Promise((r) => setTimeout(r, 300));
  server = await startServer();
  const restored = await firstState(`role=admin&pin=${PIN}`);
  assert.equal(restored.sessionId, snap.sessionId);
  assert.equal(restored.step.id, snap.step.id);
  assert.deepEqual(restored.teams.map((t) => t.cash), snap.teams.map((t) => t.cash));
  const me = await firstState(`role=play&token=${tokens[3]}`);
  assert.equal(me.me.id, 3);
  console.log('  ✓ 서버 재시작 후 같은 상태로 복구 · 학생 토큰 유지');

  // 초기화
  await admin('reset', { keepClaims: false });
  const fresh = await firstState(`role=play&token=${tokens[1]}`);
  assert.equal(fresh.tokenRejected, true);
  console.log('  ✓ 전체 초기화 후 이전 데이터 섞이지 않음');
  console.log('\n통합 테스트 통과');
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  server.kill();
  fs.rmSync(path.dirname(DATA), { recursive: true, force: true });
}
