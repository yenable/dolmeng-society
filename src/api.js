// 서버 API — Vercel 서버 함수(api/*.js)와 로컬 개발 서버(scripts/dev-server.js)가 함께 사용합니다.
// 모든 게임 계산·진행은 여기(서버)에서만 일어나고, 브라우저는 역할별 화면 데이터만 받습니다.
import crypto from 'node:crypto';
import { GameEngine, GameError, hashToken } from './engine.js';
import { SERVER_CONFIG as S } from './config.js';
import { projectRows } from './projection.js';
import { ConflictError, storeFromEnv } from './store.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createApi(store, { env = process.env } = {}) {
  // ── 상태 읽기 / 쓰기 ───────────────────────────────────────────────
  async function read(opts) {
    const { session, presence } = await store.load({ ...opts, windowMs: S.PRESENCE_WINDOW_MS });
    const engine = new GameEngine(session ? session.state : null);
    if (session) engine.state.rev = session.revision;
    const conns = Object.fromEntries((presence ?? []).map((x) => [x.team_no, x.clients]));
    return { session, engine, conns };
  }

  // 최신 상태를 읽어 fn 을 적용하고, revision 이 그대로일 때만 저장. 누가 먼저 바꿨으면 새 상태로 다시 시도.
  // → 결과 계산·제출·진행이 동시에 들어와도 정확히 한 번만 반영됨.
  async function mutate(fn) {
    for (let attempt = 0; attempt < 6; attempt++) {
      const { session, engine } = await read({});
      const result = fn(engine);
      const isNew = !session || engine.state.sessionId !== session.id;
      engine.state.rev = isNew ? 1 : session.revision + 1;
      try {
        await store.save({
          session_id: engine.state.sessionId,
          expected_session_id: session?.id ?? null,
          expected_revision: session?.revision ?? null,
          state: engine.state,
          ...projectRows(engine),
        });
        return { engine, result };
      } catch (e) {
        if (!(e instanceof ConflictError)) throw e;
        await sleep(40 + Math.random() * 120 * (attempt + 1));
      }
    }
    throw new GameError('요청이 한꺼번에 몰렸습니다. 잠시 후 다시 시도해 주세요.', 503);
  }

  // ── 교사 PIN (틀린 시도가 많으면 잠시 잠금 — 서버 인스턴스별) ───────────
  const pinFails = new Map();
  function checkPin(ip, pin) {
    const f = pinFails.get(ip);
    if (f && f.count >= 10 && Date.now() - f.at < 60_000) throw new GameError('PIN을 너무 많이 틀렸습니다. 1분 뒤 다시 시도하세요.', 429);
    const a = Buffer.from(String(pin ?? ''));
    const b = Buffer.from(String(S.ADMIN_PIN));
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      pinFails.set(ip, { count: (f && Date.now() - f.at < 60_000 ? f.count : 0) + 1, at: Date.now() });
      throw new GameError('PIN이 올바르지 않습니다.', 401);
    }
    pinFails.delete(ip);
  }

  const teamFromToken = (engine, token) => {
    const id = engine.teamIdByToken(token);
    if (!id) throw new GameError('기업 연결이 끊어졌습니다. 기업을 다시 선택해 주세요.', 401);
    return id;
  };

  // 모든 화면 데이터에 배포 버전(build)을 붙임. 열려 있던 화면이 새 배포를 만나면 한 번 새로고침해 새 화면 코드를 받음 (common.js)
  const withBuild = (view) => ({ ...view, build: env.VERCEL_GIT_COMMIT_SHA || '' });

  const playView = (engine, token, conns = {}, hasSession = true) => {
    const teamId = engine.teamIdByToken(token);
    // 토큰 무효 판정은 실제 저장된 세션을 읽었을 때만 (네트워크/DB 오류는 여기까지 오지 않음)
    return withBuild(engine.teamView(teamId, conns, { tokenRejected: !!token && !teamId && hasSession }));
  };

  const ADMIN_ACTIONS = {
    // 교사 콘솔의 [다음]/[이전] 과 TV 키보드·리모컨이 같은 명령을 씀 (presenter: true 면 안전 모드)
    // assign: 교사 콘솔에서 미제출 기업의 선택을 대신 지정하고 바로 진행 ({ 팀번호: 선택 }) — 같은 저장 안에서 한 번에 반영
    next: (e, b) => {
      if (b.assign && !b.presenter) {
        const round = e.step.round;
        e.checkFrom(b.from, b.fromReveal);
        for (const [teamId, choice] of Object.entries(b.assign)) {
          e.submit(teamId, { round, choice, reason: '', prediction: null }, { byAdmin: true });
        }
      }
      return e.next(b.from, b.fromReveal, { safe: !!b.presenter, fromHint: b.fromHint });
    },
    prev: (e, b) => e.prev(b.from, b.fromReveal, { safe: !!b.presenter, fromHint: b.fromHint }),
    // 도입 퀴즈(Q2·Q3) 초성 힌트 보이기/숨기기 (on 생략 시 토글) — TV 의 H 키·힌트 버튼과 교사 콘솔이 같이 씀
    hint: (e, b) => e.hint(b.from, b.on),
    // 기업 회의 타이머: op = add(sec: ±30·±60) | pause | resume | reset
    timer: (e, b) => e.timer(b.from, b.op, b.sec),
    goto: (e, b) => e.goto(b.stepId),
    reset: (e, b) => e.reset({ keepClaims: b.keepClaims !== false }),
    release: (e, b) => e.release(b.teamId),
    clearSubmission: (e, b) => e.clearSubmission(b.teamId, b.round),
    submitFor: (e, b) => e.submit(b.teamId, b, { byAdmin: true }),
    reflectFor: (e, b) => e.reflect(b.teamId, b, { byAdmin: true }),
    testAutoJoin: (e) => e.testAutoJoin(),
    testAutoSubmit: (e, b) => e.testAutoSubmit(b.scenario),
    testAutoComplete: (e, b) => e.testAutoComplete(b.scenario),
    testAutoReflect: (e) => e.testAutoReflect(),
  };

  // ── 라우팅 ─────────────────────────────────────────────────────────
  async function route({ method, path, query, body, headers, ip }) {
    const h = (k) => headers[k] ?? headers[k.toLowerCase()];

    if (path === '/api/config' && method === 'GET') {
      // 브라우저에 공개해도 되는 값만 (anon 키는 공개용. service_role 키는 절대 보내지 않음)
      const realtime = !!(env.SUPABASE_URL && env.SUPABASE_ANON_KEY);
      return { ok: true, supabaseUrl: realtime ? env.SUPABASE_URL : null, supabaseAnonKey: realtime ? env.SUPABASE_ANON_KEY : null };
    }

    if (path === '/api/state' && method === 'GET') {
      const role = ['play', 'display', 'admin'].includes(query.role) ? query.role : 'display';
      if (role === 'admin') checkPin(ip, h('x-admin-pin'));
      if (role === 'play') {
        const token = h('x-team-token') || '';
        const { session, engine } = await read({ tokenHash: token ? hashToken(token) : null, clientId: h('x-client-id') || null });
        return playView(engine, token, {}, !!session);
      }
      const { engine, conns } = await read({ presence: true });
      return withBuild(role === 'admin' ? engine.adminView(conns) : engine.displayView(conns));
    }

    if (method !== 'POST') throw new GameError('Not found', 404);

    if (path === '/api/play/claim') {
      const { engine, result: token } = await mutate((e) => e.claim(body.teamId));
      return { ok: true, token, view: playView(engine, token) };
    }
    if (path === '/api/play/leave') {
      await mutate((e) => e.leave(teamFromToken(e, body.token)));
      return { ok: true };
    }
    if (path === '/api/play/submit' || path === '/api/play/reflect') {
      const { engine, result } = await mutate((e) => {
        const id = teamFromToken(e, body.token);
        return path.endsWith('submit') ? e.submit(id, body) : e.reflect(id, body);
      });
      return { ok: true, already: !!result?.already, view: playView(engine, body.token) };
    }
    if (path === '/api/admin/login') {
      checkPin(ip, h('x-admin-pin'));
      const { session } = await read({});
      if (!session) await mutate(() => {}); // 첫 로그인 때 게임 세션 생성
      return { ok: true };
    }
    if (path === '/api/admin/action') {
      checkPin(ip, h('x-admin-pin'));
      const fn = ADMIN_ACTIONS[body.action];
      if (!fn) throw new GameError('알 수 없는 명령');
      const { engine } = await mutate((e) => fn(e, body));
      const conns = (await read({ presence: true })).conns;
      return { ok: true, view: withBuild(body.presenter ? engine.displayView(conns) : engine.adminView(conns)) };
    }
    throw new GameError('Not found', 404);
  }

  async function handle(req) {
    try {
      return { status: 200, body: await route(req) };
    } catch (e) {
      if (e instanceof GameError) return { status: e.status, body: { error: e.message } };
      console.error('[api]', e);
      return { status: 503, body: { error: '서버가 잠시 응답하지 못했어요. 다시 시도해 주세요.' } };
    }
  }

  return { handle, mutate, read };
}

// ── Vercel 서버 함수 어댑터 ─────────────────────────────────────────────
let shared = null;
function sharedApi() {
  if (!shared) {
    const store = storeFromEnv(process.env);
    if (!store) return null;
    shared = createApi(store);
  }
  return shared;
}

export async function vercelHandler(req, res) {
  const send = (status, body) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(body));
  };
  const api = sharedApi();
  if (!api) return send(500, { error: 'Supabase 환경변수(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)가 설정되지 않았습니다.' });
  const url = new URL(req.url, 'http://localhost');
  let body = req.body ?? {};
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body || '{}');
    } catch {
      return send(400, { error: '잘못된 요청입니다.' });
    }
  }
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '?').split(',')[0].trim();
  const out = await api.handle({
    method: req.method, path: url.pathname.replace(/\/+$/, ''), query: Object.fromEntries(url.searchParams), body, headers: req.headers, ip,
  });
  send(out.status, out.body);
}
