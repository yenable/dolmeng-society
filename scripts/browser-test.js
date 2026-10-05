// 실제 브라우저 테스트 (Edge/Chrome, puppeteer-core): 재접속·draft 복구·네트워크 끊김·프레젠터 키
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

  await c.admin('testAutoComplete', { scenario: 'profitFirst' });
  await c.admin('goto', { stepId: 'SOCIAL_SCORE_REVEAL' });
  const tv = await browser.newPage();
  await tv.goto(`${BASE}/display`);
  await tv.waitForSelector('#snum');
  await c.admin('next', { from: 'SOCIAL_SCORE_REVEAL', fromReveal: 0 });
  await tv.reload();
  await tv.waitForSelector('.sitem');
  assert.equal(await tv.$$eval('.sitem', (els) => els.length), 1);
  ok('TV 새로고침: 현재 장면(사회점수 1번째 항목)으로 복귀');

  // 보기 전용 TV: 키를 눌러도 진행되지 않음
  const s0 = await step();
  for (const k of ['ArrowRight', 'PageDown', 'Space', 'Enter']) await tv.keyboard.press(k);
  await sleep(800);
  assert.equal(await step(), s0);
  ok('일반 /display 는 키보드를 눌러도 수업 상태가 바뀌지 않음');

  // 사회점수 음수까지 애니메이션
  const total = (await c.tv()).score.total;
  for (let i = 1; i <= total; i++) await c.admin('next', { from: 'SOCIAL_SCORE_REVEAL', fromReveal: i });
  const final = (await c.tv()).score.items.at(-1).after;
  await until(async () => (await tv.$eval('#snum', (e) => e.textContent)) === (final < 0 ? `−${-final}` : String(final)), 6000, '최종 점수 표시');
  await c.admin('next', { from: 'SOCIAL_SCORE_REVEAL', fromReveal: total });
  await tv.waitForSelector('.final.show', { timeout: 6000 });
  ok(`사회점수 100 → ${final} (0 이하·음수) 감소 애니메이션 · 최종 장면`);

  // ── 5. 프레젠터 모드 ────────────────────────────────────────────────
  const pres = await browser.newPage();
  await pres.goto(`${BASE}/display?presenter=1`);
  await pres.waitForSelector('.pin-gate:not(.hidden) input');
  await pres.keyboard.press('ArrowRight'); // PIN 전에는 아무 일도 없음
  await pres.type('.pin-gate input', 'wrong');
  await pres.keyboard.press('Enter');
  await until(() => pres.$eval('.pin-err', (e) => e.textContent.includes('PIN')), 5000, 'PIN 오류');
  await pres.$eval('.pin-gate input', (e) => { e.value = ''; });
  await pres.type('.pin-gate input', PIN);
  await pres.keyboard.press('Enter');
  await pres.waitForSelector('.presenter-badge:not(.hidden)');
  await c.admin('goto', { stepId: 'FINAL_PROFIT' });
  await until(async () => (await pres.$eval('body', (e) => e.className)).includes('kind-final'), 6000, 'TV 동기화');
  const press = async (key, expect) => {
    await sleep(700);
    await pres.keyboard.press(key);
    const got = await until(async () => {
      const s = await step();
      return s === expect ? s : null;
    }, 5000, `${key} → ${expect} (현재 ${await step()})`);
    return got;
  };
  await press('ArrowRight', 'BLACKOUT:-');
  await press('PageDown', 'NEWS_CONSUMER:0');
  // 뉴스 제목 타이핑 효과
  await pres.waitForSelector('.news h1');
  const headline = (await c.tv()).news.headline;
  await sleep(1100);
  const partial = await pres.$eval('.news h1', (e) => e.textContent);
  assert.ok(partial.length < headline.length, `타이핑 중이어야 함: "${partial}"`);
  await until(async () => (await pres.$eval('.news h1', (e) => e.textContent)) === headline, 10000, '타이핑 완료');
  await press(' ', 'NEWS_CONSUMER:1');
  await pres.waitForSelector('#news-detail .lines p');
  await press('Enter', 'NEWS_ENVIRONMENT:0');
  await press('ArrowLeft', 'NEWS_CONSUMER:1');
  await press('PageUp', 'NEWS_CONSUMER:0');
  await press('Backspace', 'BLACKOUT:-');
  assert.equal(pres.url(), `${BASE}/display?presenter=1`, 'Backspace 로 페이지 뒤로가기 안 됨');
  ok('프레젠터: → PageDown Space Enter ← PageUp Backspace 각각 한 장면씩 · 뉴스 제목 타이핑');

  // 빠른 연타 · 키 반복 → 한 장면만
  await sleep(700);
  let s1 = await step();
  await pres.keyboard.press('ArrowRight');
  await pres.keyboard.press('ArrowRight');
  await pres.keyboard.press('PageDown');
  await sleep(1200);
  assert.equal(await step(), 'NEWS_CONSUMER:0', `연타 3번 → 한 장면 (${s1} → ${await step()})`);
  await sleep(700);
  await pres.keyboard.down('ArrowRight');
  await pres.keyboard.down('ArrowRight'); // 누르고 있으면 반복 입력(repeat)
  await pres.keyboard.down('ArrowRight');
  await pres.keyboard.up('ArrowRight');
  await sleep(1200);
  assert.equal(await step(), 'NEWS_CONSUMER:1');
  ok('빠른 연타·키 반복에도 한 입력당 한 화면만 이동');

  // 사회면 슬라이드
  await c.admin('goto', { stepId: 'SOCIAL_PAPER' });
  await pres.waitForSelector('.paper .article.in h2', { timeout: 6000 });
  ok('사회면 신문 슬라이드 (기사 제목 차례로 타이핑)');

  // 회의 안전: 학생 미제출이면 넘어가지 않음, 결과도 계산 안 됨
  await c.admin('reset', { keepClaims: true });
  await c.admin('goto', { stepId: 'ROUND1_MEETING' });
  await until(async () => (await pres.$eval('body', (e) => e.className)).includes('kind-meeting'), 6000, 'TV 회의 화면');
  await sleep(700);
  await pres.keyboard.press('ArrowRight');
  await pres.waitForSelector('.tv-notice.show', { timeout: 4000 });
  assert.match(await pres.$eval('.tv-notice', (e) => e.textContent), /아직 결정 중인 기업이 있습니다.*교사 화면/);
  await sleep(700);
  await pres.keyboard.press('PageDown');
  await sleep(1000);
  assert.equal(await step(), 'ROUND1_MEETING:-');
  assert.equal((await c.adminState()).rounds[1].computed, false);
  ok('프레젠터: 학생 미제출 회의 중에는 넘어가지 않고 TV에 안내 · 결과 강제 계산 없음');

  console.log(`\n브라우저 테스트 ${passed}개 통과`);
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser.close().catch(() => {});
  server.close();
  fs.rmSync(profile, { recursive: true, force: true });
}
