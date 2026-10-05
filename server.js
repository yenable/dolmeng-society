// 돌멩민국 슬랑이 시장 서버 — 의존성 없음. 실행: node server.js
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GameEngine, GameError } from './src/engine.js';
import { SERVER_CONFIG as S } from './src/config.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_FILE = path.resolve(ROOT, S.DATA_FILE);
const VIDEO_FILE = path.resolve(ROOT, S.VIDEO_FILE);

// ── 저장 / 복구 ─────────────────────────────────────────────────────
function loadState() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return null;
  }
}
function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  try {
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, file);
  } catch {
    fs.writeFileSync(file, text); // Windows 백신 등으로 rename 이 막힐 때
  }
}
const engine = new GameEngine(loadState());
function save() {
  try {
    writeAtomic(DATA_FILE, JSON.stringify(engine.state));
  } catch (e) {
    console.error('[저장 실패]', e.message);
  }
}
save();

// ── 영상 슬롯 ───────────────────────────────────────────────────────
let mediaCache = { at: 0, value: null };
function media() {
  if (Date.now() - mediaCache.at > 3000) {
    mediaCache = { at: Date.now(), value: { videoAvailable: fs.existsSync(VIDEO_FILE), videoUrl: S.VIDEO_URL } };
  }
  return mediaCache.value;
}

// ── 실시간 (SSE) ────────────────────────────────────────────────────
const clients = new Set();

function connections() {
  const c = {};
  for (const cl of clients) {
    if (cl.role !== 'play') continue;
    const id = engine.teamIdByToken(cl.token);
    if (id) c[id] = (c[id] || 0) + 1;
  }
  return c;
}

function viewFor(role, token, conns) {
  if (role === 'admin') return engine.adminView(conns, media());
  if (role === 'display') return engine.displayView(conns, media());
  const teamId = engine.teamIdByToken(token);
  return engine.teamView(teamId, conns, { tokenRejected: !!token && !teamId });
}

function send(cl, event, data) {
  try {
    cl.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch {
    clients.delete(cl);
  }
}

let broadcastQueued = false;
function broadcast() {
  if (broadcastQueued) return;
  broadcastQueued = true;
  setImmediate(() => {
    broadcastQueued = false;
    const conns = connections();
    for (const cl of clients) send(cl, 'state', viewFor(cl.role, cl.token, conns));
  });
}

function mutate(fn) {
  const result = fn();
  engine.state.rev += 1;
  save();
  broadcast();
  return result;
}

setInterval(() => {
  for (const cl of clients) send(cl, 'ping', { t: Date.now() });
}, S.HEARTBEAT_MS);

// ── HTTP 유틸 ───────────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.mp4': 'video/mp4', '.webm': 'video/webm', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 32 * 1024) {
        reject(new GameError('요청이 너무 큽니다.', 413));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        reject(new GameError('잘못된 요청입니다.'));
      }
    });
    req.on('error', reject);
  });
}

function serveFile(req, res, file) {
  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    const type = MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
    const range = req.headers.range;
    if (range && /^bytes=/.test(range)) {
      // 영상 탐색/재생을 위한 Range 지원
      const [startStr, endStr] = range.replace(/bytes=/, '').split('-');
      const start = Number(startStr) || 0;
      const end = endStr ? Math.min(Number(endStr), stat.size - 1) : stat.size - 1;
      if (start >= stat.size || start > end) {
        res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
        res.end();
        return;
      }
      res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1 });
      fs.createReadStream(file, { start, end }).pipe(res);
      return;
    }
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': stat.size, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' });
    if (req.method === 'HEAD') res.end();
    else fs.createReadStream(file).pipe(res);
  });
}

// 교사 PIN (틀린 시도가 많으면 잠시 잠금)
const pinFails = new Map();
function checkPin(req, pin) {
  const ip = req.socket.remoteAddress || '?';
  const f = pinFails.get(ip);
  if (f && f.count >= 10 && Date.now() - f.at < 60_000) throw new GameError('PIN을 너무 많이 틀렸습니다. 1분 뒤 다시 시도하세요.', 429);
  if (String(pin ?? '') !== String(S.ADMIN_PIN)) {
    pinFails.set(ip, { count: (f && Date.now() - f.at < 60_000 ? f.count : 0) + 1, at: Date.now() });
    throw new GameError('PIN이 올바르지 않습니다.', 401);
  }
  pinFails.delete(ip);
}

// ── 라우팅 ──────────────────────────────────────────────────────────
const PAGES = { '/': 'index.html', '/play': 'play.html', '/admin': 'admin.html', '/display': 'display.html' };

function teamFromToken(token) {
  const id = engine.teamIdByToken(token);
  if (!id) throw new GameError('기업 연결이 끊어졌습니다. 기업을 다시 선택해 주세요.', 401);
  return id;
}

const ADMIN_ACTIONS = {
  next: (b) => engine.next(b.from, b.fromReveal),
  prev: (b) => engine.prev(b.from, b.fromReveal),
  goto: (b) => engine.goto(b.stepId),
  reset: (b) => {
    try {
      writeAtomic(path.join(path.dirname(DATA_FILE), 'backup-before-reset.json'), JSON.stringify(engine.state));
    } catch { /* 백업 실패는 무시 */ }
    engine.reset({ keepClaims: b.keepClaims !== false });
  },
  release: (b) => engine.release(b.teamId),
  clearSubmission: (b) => engine.clearSubmission(b.teamId, b.round),
  submitFor: (b) => engine.submit(b.teamId, b, { byAdmin: true }),
  reflectFor: (b) => engine.reflect(b.teamId, b, { byAdmin: true }),
  video: (b) => engine.videoCommand(b.command),
  testAutoJoin: () => engine.testAutoJoin(),
  testAutoSubmit: (b) => engine.testAutoSubmit(b.scenario),
  testAutoComplete: (b) => engine.testAutoComplete(b.scenario),
  testAutoReflect: () => engine.testAutoReflect(),
};

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  if (p === '/events' && req.method === 'GET') {
    const role = ['play', 'display', 'admin'].includes(url.searchParams.get('role')) ? url.searchParams.get('role') : 'display';
    if (role === 'admin') {
      try {
        checkPin(req, url.searchParams.get('pin'));
      } catch (e) {
        return json(res, e.status, { error: e.message });
      }
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 2000\n\n');
    req.socket.setKeepAlive?.(true);
    const cl = { res, role, token: url.searchParams.get('token') || '' };
    clients.add(cl);
    send(cl, 'state', viewFor(role, cl.token, connections()));
    if (role === 'play') broadcast(); // 접속 상태 갱신
    req.on('close', () => {
      clients.delete(cl);
      if (role === 'play') broadcast();
    });
    return;
  }

  if (p.startsWith('/api/') && req.method === 'POST') {
    try {
      const b = await readBody(req);
      if (p === '/api/play/claim') {
        const token = mutate(() => engine.claim(b.teamId));
        return json(res, 200, { ok: true, token });
      }
      if (p === '/api/play/leave') {
        const id = teamFromToken(b.token);
        mutate(() => engine.leave(id));
        return json(res, 200, { ok: true });
      }
      if (p === '/api/play/submit' || p === '/api/play/reflect') {
        const id = teamFromToken(b.token);
        const result = mutate(() => (p.endsWith('submit') ? engine.submit(id, b) : engine.reflect(id, b)));
        return json(res, 200, { ok: true, already: !!result?.already, view: viewFor('play', b.token, connections()) });
      }
      if (p === '/api/admin/login') {
        checkPin(req, req.headers['x-admin-pin']);
        return json(res, 200, { ok: true });
      }
      if (p === '/api/admin/action') {
        checkPin(req, req.headers['x-admin-pin']);
        const fn = ADMIN_ACTIONS[b.action];
        if (!fn) throw new GameError('알 수 없는 명령');
        mutate(() => fn(b));
        return json(res, 200, { ok: true, view: viewFor('admin', null, connections()) });
      }
      throw new GameError('Not found', 404);
    } catch (e) {
      if (e instanceof GameError) return json(res, e.status, { error: e.message });
      console.error(e);
      return json(res, 500, { error: '서버 오류가 발생했습니다. 다시 시도해 주세요.' });
    }
  }

  if (req.method === 'GET' || req.method === 'HEAD') {
    if (PAGES[p]) return serveFile(req, res, path.join(PUBLIC_DIR, PAGES[p]));
    const file = path.normalize(path.join(PUBLIC_DIR, decodeURIComponent(p)));
    if (!file.startsWith(PUBLIC_DIR + path.sep)) return json(res, 403, { error: 'forbidden' });
    return serveFile(req, res, file);
  }
  json(res, 405, { error: 'method not allowed' });
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((e) => {
    console.error(e);
    try {
      json(res, 500, { error: '서버 오류' });
    } catch { /* 이미 응답함 */ }
  });
});
server.keepAliveTimeout = 65_000;
server.requestTimeout = 0; // SSE 연결이 끊기지 않도록

process.on('uncaughtException', (e) => console.error('[오류]', e));
process.on('unhandledRejection', (e) => console.error('[오류]', e));

server.listen(S.PORT, () => {
  const ips = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
  console.log('\n  돌멩민국 슬랑이 시장 서버가 켜졌습니다.\n');
  console.log(`  이 컴퓨터:   http://localhost:${S.PORT}`);
  for (const ip of ips) console.log(`  같은 와이파이: http://${ip}:${S.PORT}`);
  console.log('\n  학생: /play   TV: /display   교사: /admin');
  console.log(`  교사 PIN: ${S.ADMIN_PIN}  (src/config.js 또는 환경변수 ADMIN_PIN 으로 변경)`);
  console.log(`  영상 파일: ${fs.existsSync(VIDEO_FILE) ? '있음' : '없음 → 대체 슬라이드 사용'} (${S.VIDEO_FILE})\n`);
});
