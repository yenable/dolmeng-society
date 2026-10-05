// 로컬 개발/테스트 서버 — Vercel 과 같은 주소 구조(정적 파일 + /api/*)를 흉내 냅니다.
//   npm run dev                 .env 에 Supabase 값이 있으면 Supabase 사용, 없으면 메모리(재시작하면 초기화)
//   npm run dev -- --memory     항상 메모리 저장소 사용
// ※ 운영(수업)은 Vercel + Supabase 로 합니다. 이 서버는 수업용이 아닙니다.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const PAGES = { '/': 'index.html', '/play': 'index.html', '/admin': 'admin.html', '/display': 'display.html' };
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};

export function loadDotEnv(file = path.join(ROOT, '.env')) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

export async function startDevServer({ port = 3000, store = null, env = process.env } = {}) {
  const { createApi } = await import(pathToFileURL(path.join(ROOT, 'src/api.js')).href);
  const { storeFromEnv } = await import(pathToFileURL(path.join(ROOT, 'src/store.js')).href);
  const st = store ?? storeFromEnv(env, { allowMemory: true });
  const api = createApi(st, { env });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;
    if (p.startsWith('/api/')) {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      let body = {};
      try {
        body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
      } catch {
        body = {};
      }
      const out = await api.handle({
        method: req.method, path: p.replace(/\/+$/, ''), query: Object.fromEntries(url.searchParams), body, headers: req.headers, ip: req.socket.remoteAddress || '?',
      });
      res.writeHead(out.status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(out.body));
      return;
    }
    const file = PAGES[p] ? path.join(PUBLIC_DIR, PAGES[p]) : path.normalize(path.join(PUBLIC_DIR, decodeURIComponent(p)));
    if (!file.startsWith(PUBLIC_DIR + path.sep)) {
      res.writeHead(403);
      res.end('forbidden');
      return;
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(data);
    });
  });
  await new Promise((resolve) => server.listen(port, resolve));
  return { server, store: st, api, port: server.address().port };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  loadDotEnv();
  const memory = process.argv.includes('--memory');
  const env = memory ? { ...process.env, SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '', SUPABASE_ANON_KEY: '' } : process.env;
  const { store, port } = await startDevServer({ port: Number(process.env.PORT) || 3000, env });
  const kind = store.constructor.name === 'SupabaseStore' ? 'Supabase' : '메모리 (끄면 초기화됨)';
  console.log(`\n  돌멩민국 슬랑이 시장 — 로컬 개발 서버 (저장소: ${kind})\n`);
  console.log(`  학생: http://localhost:${port}/`);
  console.log(`  TV:   http://localhost:${port}/display   (프레젠터: /display?presenter=1)`);
  console.log(`  교사: http://localhost:${port}/admin\n`);
}
