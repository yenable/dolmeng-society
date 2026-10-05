// 실제 브라우저 테스트 (Edge/Chrome, puppeteer-core): 재접속·draft 복구·네트워크 끊김·TV 키보드 진행·최종 순위/뉴스/티커/사회점수 연출
//   node scripts/browser-test.js
//   브라우저 경로가 다르면: BROWSER_PATH="C:\...\chrome.exe" node scripts/browser-test.js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { startDevServer } from './dev-server.js';
import { client, PIN } from './lib/flow.js';

process.env.ADMIN_PIN = PIN;
const BROWSER = process.env.BROWSER_PATH || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find((p) => fs.existsSync(p));
if (!BROWSER) {
  console.log('브라우저를 찾지 못해 건너뜁니다. (BROWSER_PATH 지정)');
  process.exit(0);
}

const { MemoryStore } = await import('../src/store.js');
const { server, port } = await startDevServer({ port: 0, store: new MemoryStore(), env: {} });
const BASE = `http://127.0.0.1:${port}`;
const c = client(BASE);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'slangi-browser-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 8000, label = '조건') {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    try {
      last = await fn();
      if (last) return last;
    } catch (e) {
      last = e;
    }
    await sleep(150);
  }
  throw new Error(`시간 초과: ${label} (${last})`);
}
const launch = () => puppeteer.launch({ executablePath: BROWSER, headless: true, userDataDir: profile, args: ['--no-first-run', '--autoplay-policy=no-user-gesture-required'] });
const step = async () => {
  const v = await c.tv();
  return `${v.step.id}:${v.reveal?.index ?? '-'}`;
};
let passed = 0;
const ok = (msg) => {
  passed++;
  console.log(`  ✓ ${msg}`);
};

let browser = await launch();
try {
  console.log(`브라우저 테스트 (${path.basename(BROWSER)})`);
  await c.post('/api/admin/login', {}, { 'x-admin-pin': PIN });

  // ── 1. 학생: 기업 선택 → 2라운드 → 이유 일부 입력 → 새로고침 ──────────
  let page = await browser.newPage();
  page.on('dialog', (d) => d.accept());
  await page.goto(`${BASE}/`);
  await page.waitForSelector('.company-btn[data-team="1"]');
  assert.ok((await page.content()).includes('우리 모둠의 기업을 골라 주세요'));
  await page.click('.company-btn[data-team="1"]');
  await page.waitForSelector('#hud .brand');
  assert.match(await page.$eval('#hud .brand', (e) => e.textContent), /말랑컴퍼니/);
  for (const id of [2, 3, 4, 5]) await c.post('/api/play/claim', { teamId: id });
  await c.admin('goto', { stepId: 'ROUND1_MEETING' });
  await page.waitForSelector('#opts .opt', { timeout: 8000 });
  await page.click('#opts .opt[data-value="10000"]');
  await page.type('#reason', '많이 팔 수 있을 것 같기');
  await page.click('#submit');
  await until(async () => (await c.adminState()).submissions[1][1], 8000, '1라운드 제출');
  await c.admin('testAutoSubmit', { scenario: 'random' });
  await c.admin('goto', { stepId: 'ROUND1_RANK' });
  await c.admin('goto', { stepId: 'ROUND2_MEETING' });
  await page.waitForSelector('#opts .opt[data-value="exaggerated"]', { timeout: 8000 });
  await page.click('#opts .opt[data-value="exaggerated"]');
  await page.type('#reason', '적은 비용으로 많이');
  const cashBefore = (await c.adminState()).teams[0].cash;
  const rankBefore = (await c.adminState()).teams[0].rank;
  await page.reload();
  await page.waitForSelector('#reason', { timeout: 8000 });
  assert.equal(await page.$eval('#reason', (e) => e.value), '적은 비용으로 많이');
  assert.equal(await page.$eval('#opts .opt[data-value="exaggerated"]', (e) => e.getAttribute('aria-pressed')), 'true');
  assert.match(await page.$eval('#hud .brand', (e) => e.textContent), /말랑컴퍼니/);
  assert.equal(await page.$eval('#h-cash', (e) => e.textContent), `${cashBefore.toLocaleString('ko-KR')}원`);
  assert.match(await page.$eval('#h-rank', (e) => e.textContent), new RegExp(`${rankBefore}위`));
  ok('새로고침: 같은 기업 자동 복귀 · 입력 중이던 이유/선택 복구 · 돈/순위 유지');
  await until(() => page.$eval('#linkstate', (e) => e.textContent.includes('연결됨') || e.textContent.includes('다시 연결되었습니다')), 5000, '연결 표시');

  // ── 2. 네트워크 끊김 → 복구: 기업 선택이 초기화되지 않음 ────────────────
  await page.setOfflineMode(true);
  await until(() => page.$eval('#linkstate', (e) => e.textContent.includes('다시 연결하는 중')), 10000, '끊김 표시');
  await sleep(3000);
  assert.ok(await page.evaluate(() => !!localStorage.getItem('slangi.token')), '오프라인 중에도 토큰 유지');
  await page.setOfflineMode(false);
  await until(() => page.$eval('#linkstate', (e) => e.textContent.includes('다시 연결되었습니다')), 10000, '복구 표시');
  assert.match(await page.$eval('#hud .brand', (e) => e.textContent), /말랑컴퍼니/);
  assert.equal(await page.$eval('#reason', (e) => e.value), '적은 비용으로 많이');
  await until(() => page.$eval('#linkstate', (e) => e.textContent === '● 연결됨'), 10000, '복구 표시 후 "연결됨"으로 돌아옴');
  ok('네트워크 끊김 → "다시 연결하는 중…" → "다시 연결되었습니다." · 토큰·기업·draft 유지');

  // 서버 오류(503)도 토큰 무효로 취급하지 않음
  await page.setRequestInterception(true);
  const fail = (r) => (r.url().includes('/api/state') ? r.respond({ status: 503, body: '{}' }) : r.continue());
  page.on('request', fail);
  await sleep(5000);
  page.off('request', fail);
  await page.setRequestInterception(false);
  assert.ok(await page.evaluate(() => !!localStorage.getItem('slangi.token')));
  await until(async () => (await page.$eval('#hud .brand', (e) => e.textContent)).includes('말랑컴퍼니'), 8000, '복구');
  ok('서버가 잠시 503 을 내도 기업 선택 화면으로 튕기지 않음');

  // ── 3. 브라우저 종료 후 다시 / 접속 ────────────────────────────────
  await browser.close();
  browser = await launch();
  page = await browser.newPage();
  page.on('dialog', (d) => d.accept());
  await page.goto(`${BASE}/`);
  const first = await page.$eval('#main', (e) => e.textContent);
  await page.waitForSelector('#reason', { timeout: 8000 });
  assert.match(await page.$eval('#hud .brand', (e) => e.textContent), /말랑컴퍼니/);
  assert.equal(await page.$eval('#reason', (e) => e.value), '적은 비용으로 많이');
  ok(`브라우저를 닫았다 다시 열어도 같은 기업 자동 복귀 (첫 화면: "${first.trim().slice(0, 30)}")`);

  // 교사 연결 해제 = 진짜 무효 → 그때만 기업 선택 화면
  await c.admin('release', { teamId: 1 });
  await page.waitForSelector('.company-btn', { timeout: 8000 });
  assert.equal(await page.evaluate(() => localStorage.getItem('slangi.token')), null);
  await page.click('.company-btn[data-team="1"]');
  await page.waitForSelector('#hud .brand');
  ok('교사가 연결 해제했을 때만 토큰 삭제 → 다시 선택하면 기록 그대로 이어서');

  // ── 4. 교사 콘솔 / TV 새로고침 ───────────────────────────────────────
  const admin = await browser.newPage();
  admin.on('dialog', (d) => d.accept());
  await admin.goto(`${BASE}/admin`);
  await admin.waitForSelector('#pin');
  await admin.type('#pin', PIN);
  await admin.click('#login-form button');
  await admin.waitForSelector('#nav .nav-now');
  const navText = () => admin.$eval('#nav .nav-now .v', (e) => e.textContent);
  assert.match(await navText(), /2라운드/);
  await admin.reload();
  await admin.waitForSelector('#nav .nav-now');
  assert.match(await navText(), /2라운드/);
  ok('교사 콘솔 새로고침: 로그인·진행 단계 유지');

  // ── 5. TV: 최종 순위 시상식 연출 (3위 → 2위 → 1위 → 4·5위) ──────────────
  await c.admin('testAutoComplete', { scenario: 'profitFirst' }); // → FINAL_PROFIT
  const tv = await browser.newPage();
  await tv.goto(`${BASE}/display`);
  await tv.waitForSelector('.final-wrap');
  const t0 = Date.now();
  const shown = () => tv.$$eval('.pod.in, .rest.in', (els) => els.map((e) => (e.classList.contains('rest') ? 'rest' : [...e.classList].find((c) => /^p\d$/.test(c)))));
  assert.deepEqual(await shown(), [], '처음엔 빈 무대');
  const order = [];
  await until(async () => {
    for (const k of await shown()) if (!order.includes(k)) order.push(k);
    return order.length === 4;
  }, 8000, '순차 공개');
  const took = Date.now() - t0;
  assert.deepEqual(order, ['p3', 'p2', 'p1', 'rest']);
  assert.ok(took >= 3000 && took <= 6000, `연출 시간 ${took}ms`);
  assert.match(await tv.$eval('.pod.p1', (e) => e.textContent), /축하합니다! 🎉/);
  assert.match(await tv.$eval('.pod.p1', (e) => getComputedStyle(e).animationName), /champIn/);
  ok(`최종 순위: 빈 무대 → 3위 → 2위 → 1위(강조·축하) → 4·5위 순서로 자동 공개 (${(took / 1000).toFixed(1)}초)`);

  // 같은 화면에서 상태 갱신이 와도 연출을 다시 하지 않음
  await c.admin('testAutoJoin');
  await sleep(2600);
  assert.equal((await shown()).length, 4);

  // ── 6. 전체화면 버튼 (밝은 화면) ─────────────────────────────────────
  const fsLabel = () => tv.$eval('.fs-btn', (e) => e.textContent);
  const fsCheck = async (where) => {
    const before = await step();
    assert.equal(await fsLabel(), '⛶ 전체화면');
    const box = await tv.$eval('.fs-btn', (e) => { const r = e.getBoundingClientRect(); return { right: innerWidth - r.right, bottom: innerHeight - r.bottom, pos: getComputedStyle(e).position }; });
    assert.equal(box.pos, 'fixed');
    assert.ok(box.right < 40 && box.bottom < 40, `오른쪽 아래 ${JSON.stringify(box)}`);
    await tv.click('.fs-btn');
    await until(() => tv.evaluate(() => !!document.fullscreenElement), 4000, `${where} 전체화면 진입`);
    await until(async () => (await fsLabel()) === '⤢ 전체화면 종료', 3000, '문구 변경');
    await tv.click('.fs-btn');
    await until(() => tv.evaluate(() => !document.fullscreenElement), 4000, `${where} 전체화면 종료`);
    await until(async () => (await fsLabel()) === '⛶ 전체화면', 3000, '문구 복귀');
    assert.equal(await tv.evaluate(() => document.activeElement === document.querySelector('.fs-btn')), false, '버튼에 포커스 남지 않음');
    assert.equal(await step(), before, '버튼 클릭으로 진행되지 않음');
  };
  await fsCheck('밝은 화면');

  // ── 7. 일반 /display 키보드 진행 (같은 컴퓨터의 교사 콘솔 PIN 재사용) ──────
  const press = async (page, key, expect) => {
    await sleep(700);
    await page.keyboard.press(key);
    return until(async () => ((await step()) === expect ? expect : null), 5000, `${key} → ${expect} (현재 ${await step()})`);
  };
  await until(() => tv.$eval('.presenter-badge', (e) => !e.classList.contains('hidden')), 5000, '리모컨 진행 표시');
  await press(tv, 'ArrowRight', 'BLACKOUT:-');
  await fsCheck('검정 화면');
  await press(tv, 'PageDown', 'NEWS_CONSUMER:-');

  // 뉴스: 제목 타이핑 → (클릭 없이) 기사 내용 자동 등장
  await tv.waitForSelector('.news h1');
  const headline = (await c.tv()).news.headline;
  await sleep(1300);
  const partial = await tv.$eval('.news h1', (e) => e.textContent);
  assert.ok(partial.length < headline.length, `타이핑 중이어야 함: "${partial}"`);
  assert.equal(await tv.$('#news-detail.show'), null, '타이핑 중에는 기사 내용 없음');
  await until(async () => (await tv.$eval('.news h1', (e) => e.textContent)) === headline, 10000, '타이핑 완료');
  const typedAt = Date.now();
  await tv.waitForSelector('#news-detail.show', { timeout: 4000 });
  const gap = Date.now() - typedAt;
  assert.ok(gap >= 600 && gap <= 2000, `제목 끝 → 기사 ${gap}ms`);
  await until(() => tv.$eval('#news-detail .chips', (e) => getComputedStyle(e).opacity === '1'), 5000, '관련 기업 등장');
  await sleep(1500);
  assert.equal(await step(), 'NEWS_CONSUMER:-', '기사 내용 후 자동으로 넘어가지 않음');
  ok(`뉴스: 속보 → 제목 타이핑 → ${(gap / 1000).toFixed(1)}초 뒤 기사·관련 기업 자동 등장 → 정지`);

  // 티커: 50초 일정 속도, 상태 갱신(Realtime/polling)에도 DOM·애니메이션 유지
  const tick = () => tv.$eval('.ticker-track', (e) => {
    if (!window.__trk) window.__trk = e;
    const a = e.getAnimations()[0];
    return { same: window.__trk === e && e.isConnected, t: a.currentTime, dur: getComputedStyle(e).animationDuration, tf: getComputedStyle(e).animationTimingFunction, x: new DOMMatrix(getComputedStyle(e).transform).m41 };
  });
  const k1 = await tick();
  assert.equal(k1.dur, '50s');
  assert.equal(k1.tf, 'linear');
  await c.admin('testAutoJoin'); // 상태 revision 변경 → TV 가 새 상태를 받음
  await sleep(2600);
  await tv.evaluate(() => window.dispatchEvent(new Event('focus'))); // 즉시 다시 받아오기
  await sleep(600);
  const k2 = await tick();
  assert.ok(k2.same, '티커 DOM 이 다시 만들어지지 않음');
  assert.ok(k2.t > k1.t + 2500, `애니메이션이 처음부터 다시 시작되지 않음 (${k1.t} → ${k2.t})`);
  assert.ok(k2.x < k1.x, '계속 왼쪽으로 이동');
  // 한 바퀴 이동 범위: 오른쪽 바깥에서 시작 → 왼쪽 바깥까지
  const range = await tv.$eval('.ticker-track', (e) => {
    const a = e.getAnimations()[0];
    const kf = a.effect.getKeyframes();
    const w = e.getBoundingClientRect().width;
    a.pause();
    const cur = a.currentTime;
    a.currentTime = 0;
    const start = e.getBoundingClientRect().left;
    a.currentTime = 50000 - 1;
    const end = e.getBoundingClientRect().right;
    a.currentTime = cur;
    a.play();
    return { start, end, vw: innerWidth, w, kf: kf.length };
  });
  assert.ok(range.start >= range.vw - 2, `오른쪽 바깥에서 시작 ${JSON.stringify(range)}`);
  assert.ok(range.end <= 2, `왼쪽 바깥까지 이동 ${JSON.stringify(range)}`);
  // 일정한 속도: 1초 간격 이동 거리 비교
  const speed = await tv.$eval('.ticker-track', async (e) => {
    const xs = [];
    for (let i = 0; i < 4; i++) {
      xs.push(e.getBoundingClientRect().left);
      await new Promise((r) => setTimeout(r, 1000));
    }
    return xs.slice(1).map((x, i) => xs[i] - x);
  });
  const avgSp = speed.reduce((a, b) => a + b, 0) / speed.length;
  assert.ok(speed.every((d) => d > 0 && Math.abs(d - avgSp) / avgSp < 0.15), `일정한 속도 ${speed.map((d) => d.toFixed(1))}`);
  ok(`티커: 50초·linear·translate3d, 오른쪽 바깥 → 왼쪽 바깥, 초당 ${avgSp.toFixed(0)}px 일정, 상태 갱신에도 끊김·재시작 없음`);

  await press(tv, 'Enter', 'NEWS_ENVIRONMENT:-');
  await press(tv, 'ArrowLeft', 'NEWS_CONSUMER:-');
  assert.ok(await tv.$('#news-detail.show.instant'), '뒤로 오면 기사까지 바로 보임');
  await press(tv, 'PageUp', 'BLACKOUT:-');
  await press(tv, 'Backspace', 'FINAL_PROFIT:-');
  assert.equal(tv.url(), `${BASE}/display`, 'Backspace 로 페이지 뒤로가기 안 됨');
  await press(tv, ' ', 'BLACKOUT:-');
  ok('일반 /display: → PageDown Enter Space ← PageUp Backspace 각각 한 장면씩 (교사 콘솔 PIN 재사용)');

  // 빠른 연타 · 키 반복 → 한 장면만
  await sleep(700);
  await tv.keyboard.press('ArrowRight');
  await tv.keyboard.press('ArrowRight');
  await tv.keyboard.press('PageDown');
  await sleep(1200);
  assert.equal(await step(), 'NEWS_CONSUMER:-', '연타 3번 → 한 장면');
  await sleep(700);
  await tv.keyboard.down('ArrowRight');
  await tv.keyboard.down('ArrowRight'); // 누르고 있으면 반복 입력(repeat)
  await tv.keyboard.down('ArrowRight');
  await tv.keyboard.up('ArrowRight');
  await sleep(1200);
  assert.equal(await step(), 'NEWS_ENVIRONMENT:-');
  ok('빠른 연타·키 반복에도 한 입력당 한 화면만 이동');

  // ── 8. 사회점수: 범주별 공개 → 최종 점수 중앙 이동 + 빨간색 + 발문 ─────────
  await c.admin('goto', { stepId: 'SOCIAL_PAPER' });
  await tv.waitForSelector('.paper .article.in h2', { timeout: 6000 });
  await press(tv, 'ArrowRight', 'SOCIAL_SCORE_REVEAL:0');
  await tv.waitForSelector('.score-empty');
  assert.equal(await tv.$eval('#snum', (e) => e.textContent), '100');
  const snum = () => tv.$eval('#snum', (e) => e.textContent);
  const expectScore = async (key, n, cats, txt) => {
    await press(tv, key, `SOCIAL_SCORE_REVEAL:${n}`);
    await until(async () => (await snum()) === txt, 5000, `점수 ${txt}`);
    assert.equal(await tv.$$eval('.scat', (els) => els.length), cats);
  };
  // profitFirst: 과장 5(-100) · 절감 5(-100) · 담합 5(-30)
  await expectScore('ArrowRight', 1, 1, '0');
  assert.match(await tv.$eval('.scat.consumer', (e) => e.textContent), /소비자 보호\s*−100[\s\S]*과장 광고를 선택한 기업 5곳[\s\S]*말랑컴퍼니·통통슬라임·몽글기업·쫀득상사·젤리팩토리/);
  await expectScore('PageDown', 2, 2, '−100');
  assert.match(await tv.$eval('.scat.environment', (e) => e.textContent), /비용 절감 생산 5곳/);
  await expectScore('ArrowRight', 3, 3, '−130');
  assert.match(await tv.$eval('.scat.fairness', (e) => e.textContent), /공동 가격 제안 참여 5 \/ 5 기업/);
  await expectScore('PageUp', 2, 2, '−100');
  await expectScore('ArrowRight', 3, 3, '−130');
  ok('사회점수: 100 → 소비자 보호(−100) → 환경(−100) → 공정 경쟁(−30) 범주별 한 번씩, ← PageUp 으로 되돌리기');

  const rect0 = await tv.$eval('#snum', (e) => e.getBoundingClientRect().toJSON());
  await press(tv, 'ArrowRight', 'SOCIAL_SCORE_REVEAL:4');
  await tv.waitForSelector('.score.is-final');
  await sleep(150);
  const mid = await tv.$eval('#snum', (e) => ({ tf: e.style.transform, r: e.getBoundingClientRect().toJSON() }));
  assert.equal(await tv.$('.score-q.show'), null, '발문은 점수가 자리 잡은 뒤에');
  await until(() => tv.$('.score-q.show'), 4000, '발문 등장');
  await sleep(1300);
  const fin = await tv.$eval('#snum', (e) => ({ r: e.getBoundingClientRect().toJSON(), color: getComputedStyle(e).color, txt: e.textContent }));
  const vw = await tv.evaluate(() => innerWidth);
  assert.equal(fin.txt, '−130');
  assert.ok(Math.abs(fin.r.x + fin.r.width / 2 - vw / 2) < vw * 0.03, '가운데로 이동');
  assert.ok(fin.r.height > rect0.height * 1.5, '크게');
  assert.ok(mid.r.x + mid.r.width / 2 < fin.r.x + fin.r.width / 2 - 20, `왼쪽 자리에서 가운데로 움직이는 중 (${mid.tf})`);
  const [rr, gg, bb] = fin.color.match(/\d+/g).map(Number);
  assert.ok(rr > 200 && gg < 90 && bb < 90, `빨간색 ${fin.color}`);
  assert.match(await tv.$eval('.score-q', (e) => e.textContent), /왜 돌멩민국의 사회점수는 낮아졌을까요[\s\S]*누구에게 어떤 영향을/);
  assert.equal(await tv.evaluate(() => document.body.classList.contains('dark')), true);
  await sleep(2500);
  assert.equal(await step(), 'SOCIAL_SCORE_REVEAL:4', '최종 발문에서 자동으로 넘어가지 않음');
  ok('최종 사회점수: 왼쪽 점수가 가운데로 이동(FLIP)·확대·빨간색 → 발문 fade in → 정지');

  await press(tv, 'ArrowLeft', 'SOCIAL_SCORE_REVEAL:3');
  await tv.waitForSelector('.score:not(.is-final) .scat');
  await press(tv, 'ArrowRight', 'SOCIAL_SCORE_REVEAL:4');
  await press(tv, 'ArrowRight', 'REFLECTION:-');
  await tv.waitForSelector('.refl-title');
  assert.match(await tv.$eval('.round-label', (e) => e.textContent), /우리 기업의 선택 다시 생각하기/);
  // 정리 활동 미제출 → 키보드로 넘어가지 않음
  await sleep(700);
  await tv.keyboard.press('ArrowRight');
  await tv.waitForSelector('.tv-notice.show', { timeout: 4000 });
  assert.match(await tv.$eval('.tv-notice', (e) => e.textContent), /아직 정리 활동을 쓰고 있는 기업이 있습니다.*교사 화면/);
  assert.equal(await step(), 'REFLECTION:-');
  ok('최종 발문 → 우리 기업의 선택 다시 생각하기 · 정리 활동 작성 중에는 TV 키로 넘어가지 않음');

  // TV 새로고침: 현재 장면 유지
  await c.admin('goto', { stepId: 'SOCIAL_PAPER' });
  await c.admin('next', { from: 'SOCIAL_PAPER' });
  await c.admin('next', { from: 'SOCIAL_SCORE_REVEAL', fromReveal: 0 });
  await tv.reload();
  await tv.waitForSelector('.scat');
  assert.equal(await tv.$$eval('.scat', (els) => els.length), 1);
  ok('TV 새로고침: 현재 장면(사회점수 소비자 보호)으로 복귀');

  // ── 9. PIN 이 저장되지 않은 컴퓨터: 처음 키를 누르면 PIN 한 번 ─────────────
  const ctx = await browser.createBrowserContext();
  const fresh = await ctx.newPage();
  await fresh.goto(`${BASE}/display`);
  await fresh.waitForSelector('#snum');
  assert.ok(await fresh.$('.pin-gate.hidden'), '처음엔 PIN 창 없음');
  const s9 = await step();
  await fresh.keyboard.press('ArrowRight');
  await fresh.waitForSelector('.pin-gate:not(.hidden) input');
  assert.equal(await step(), s9);
  await fresh.type('.pin-gate input', 'wrong');
  await fresh.keyboard.press('Enter');
  await until(() => fresh.$eval('.pin-err', (e) => e.textContent.includes('PIN')), 5000, 'PIN 오류');
  await fresh.$eval('.pin-gate input', (e) => { e.value = ''; });
  await fresh.type('.pin-gate input', PIN);
  await fresh.keyboard.press('Enter');
  await fresh.waitForSelector('.presenter-badge:not(.hidden)');
  await press(fresh, 'ArrowRight', 'SOCIAL_SCORE_REVEAL:2');
  await fresh.reload();
  await fresh.waitForSelector('.presenter-badge:not(.hidden)', { timeout: 5000 });
  await press(fresh, 'ArrowLeft', 'SOCIAL_SCORE_REVEAL:1');
  ok('PIN 이 없는 TV: 처음 키 입력 때 PIN 한 번 → 기억되어 새로고침 후에도 바로 진행');

  // 예전 주소 /display?presenter=1 호환
  const old = await ctx.newPage();
  await old.goto(`${BASE}/display?presenter=1`);
  await old.waitForSelector('.presenter-badge:not(.hidden)', { timeout: 5000 });
  await press(old, 'PageDown', 'SOCIAL_SCORE_REVEAL:2');
  ok('/display?presenter=1 도 그대로 동작');

  // 미리보기(/display?preview=1)는 절대 키보드 진행 안 함
  const pv = await ctx.newPage();
  await pv.goto(`${BASE}/display?preview=1`);
  await pv.waitForSelector('#snum');
  const s10 = await step();
  for (const k of ['ArrowRight', 'PageDown', 'Enter', ' ']) {
    await sleep(700);
    await pv.keyboard.press(k);
  }
  await sleep(1000);
  assert.equal(await step(), s10);
  assert.equal(await pv.$('.pin-gate'), null);
  assert.equal(await pv.$('.fs-btn'), null);
  ok('/display?preview=1 은 키를 눌러도 진행되지 않음');
  await ctx.close();

  // ── 10. 회의 안전: 학생 미제출이면 일반 TV 키로 넘어가지 않음 ─────────────
  await c.admin('reset', { keepClaims: true });
  await c.admin('goto', { stepId: 'ROUND1_MEETING' });
  await until(async () => (await tv.$eval('body', (e) => e.className)).includes('kind-meeting'), 6000, 'TV 회의 화면');
  await sleep(700);
  await tv.keyboard.press('ArrowRight');
  await tv.waitForSelector('.tv-notice.show', { timeout: 4000 });
  assert.match(await tv.$eval('.tv-notice', (e) => e.textContent), /아직 결정 중인 기업이 있습니다.*강제 진행은 교사 화면에서 할 수 있습니다/);
  await sleep(700);
  await tv.keyboard.press('PageDown');
  await sleep(1000);
  assert.equal(await step(), 'ROUND1_MEETING:-');
  assert.equal((await c.adminState()).rounds[1].computed, false);
  ok('일반 TV: 학생 미제출 회의 중에는 넘어가지 않고 TV에 안내 · 결과 강제 계산 없음');

  // ── 11. 교사 콘솔: 미제출 기업 선택 지정 창 → 지정하고 진행 ──────────────
  await c.admin('testAutoSubmit', { scenario: 'random' });
  await c.admin('goto', { stepId: 'ROUND2_MEETING' });
  for (const id of [1, 2, 3, 4]) await c.admin('submitFor', { teamId: id, round: 2, choice: 'honest', reason: '테스트' });
  await c.admin('next', { from: 'ROUND2_MEETING' });
  await admin.bringToFront();
  await until(() => admin.$eval('#nav .warn', (e) => e.textContent.includes('젤리팩토리가 아직 광고 방법을 선택하지 않았습니다')), 8000, '교사 콘솔 경고');
  await admin.click('#next');
  await admin.waitForSelector('#dlg[open] fieldset.assign');
  assert.equal(await admin.$$eval('#dlg fieldset.assign input[type=radio]', (els) => els.length), 3, '광고 3개 중 하나 (광고 안 함 없음)');
  await admin.click('#dlg-ok'); // 선택 안 하고 누르면 진행 안 됨
  await sleep(500);
  assert.equal((await c.adminState()).rounds[2].computed, false);
  await admin.click('#dlg fieldset.assign input[value="exaggerated"]');
  await admin.click('#dlg-ok');
  await until(async () => (await c.adminState()).rounds[2].computed, 6000, '지정 후 계산');
  const st2 = await c.adminState();
  assert.equal(st2.step.id, 'ROUND2_RESULT');
  assert.equal(st2.submissions[2][5].choice, 'exaggerated');
  assert.equal(st2.submissions[2][5].byAdmin, true);
  ok('교사 콘솔: 미제출 기업이 있으면 자동 기본값 대신 선택 지정 창 → 지정하고 진행');

  console.log(`\n브라우저 테스트 ${passed}개 통과`);
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser.close().catch(() => {});
  server.close();
  fs.rmSync(profile, { recursive: true, force: true });
}
