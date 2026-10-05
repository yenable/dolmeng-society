// Supabase 스키마 통합 테스트 — 실제 supabase/schema.sql 을 Postgres(PGlite, WASM)에 실행하고,
// 서버 코드가 쓰는 SupabaseStore 를 그대로 사용해 한 판 전체를 진행합니다.
//   node scripts/db-test.js      (devDependency: @electric-sql/pglite)
// PostgREST 대신 /rest/v1/rpc/<함수> 요청을 같은 함수 호출로 바꿔 주는 작은 가짜 fetch 를 씁니다.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { startDevServer } from './dev-server.js';
import { runFlow, PIN, client } from './lib/flow.js';

process.env.ADMIN_PIN = PIN;
const { SupabaseStore } = await import('../src/store.js');
const SERVICE_KEY = 'test-service-role-key';
const schema = fs.readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');

const db = new PGlite();
// Supabase 에 원래 있는 역할들
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  grant usage on schema public to anon, authenticated, service_role;
`);
await db.exec(schema);
await db.exec(schema); // 두 번 실행해도 안전해야 함

// 가짜 PostgREST: POST /rest/v1/rpc/:fn {p} → select fn(p) (service_role 로 실행)
let queue = Promise.resolve();
const fakeFetch = async (url, init) => {
  const m = String(url).match(/\/rest\/v1\/rpc\/(\w+)$/);
  if (!m || init.headers.apikey !== SERVICE_KEY) return new Response(JSON.stringify({ message: 'unauthorized' }), { status: 401 });
  const { p } = JSON.parse(init.body);
  const run = async () => {
    try {
      const r = await db.transaction(async (tx) => {
        await tx.query('set local role service_role');
        return tx.query(`select public.${m[1]}($1::jsonb) as r`, [JSON.stringify(p)]);
      });
      return new Response(JSON.stringify(r.rows[0].r), { status: 200 });
    } catch (e) {
      return new Response(JSON.stringify({ code: e.code, message: e.message }), { status: e.code === '23505' ? 409 : 400 });
    }
  };
  // 실제 서버처럼 요청들이 서로 끼어들 수 있게 하되, PGlite 는 연결이 하나라 순서대로 실행
  const result = queue.then(run);
  queue = result.catch(() => {});
  await new Promise((r) => setTimeout(r, Math.random() * 5));
  return result;
};
const store = new SupabaseStore('http://supabase.test', SERVICE_KEY, { fetchImpl: fakeFetch });
let conflicts = 0;
const rawSave = store.save.bind(store);
store.save = (p) => rawSave(p).catch((e) => {
  if (/REVISION_CONFLICT/.test(e.message)) conflicts += 1;
  throw e;
});

const servers = [];
const start = async () => {
  const s = await startDevServer({ port: 0, store, env: {} });
  servers.push(s.server);
  return `http://127.0.0.1:${s.port}`;
};
const one = async (sql, params) => (await db.query(sql, params)).rows;

try {
  console.log('Supabase 스키마 통합 테스트 (PGlite)');
  const base = await start();
  await runFlow(base, { restart: start });
  assert.ok(conflicts > 0, '동시 요청에서 revision 충돌→재시도 경로가 실제로 실행됨');
  console.log(`  ✓ 동시 요청 중 revision 충돌 ${conflicts}회 → 최신 상태로 재시도 (중복 반영 없음)`);

  // 마지막 초기화 이전(보관된) 세션에서 한 판 기록이 정규화 테이블에 정확히 남았는지 확인
  const c = client(base);
  await c.admin('reset', { keepClaims: false });
  const tokens = {};
  for (const id of [1, 2, 3, 4, 5]) tokens[id] = (await c.post('/api/play/claim', { teamId: id })).body.token;
  await c.admin('testAutoComplete', { scenario: 'profitFirst' });
  // 결과 단계를 오가며 여러 번 눌러도 기록은 그대로
  await c.admin('goto', { stepId: 'ROUND4_RESULT' });
  await Promise.all([c.admin('goto', { stepId: 'ROUND3_RESULT' }), c.admin('goto', { stepId: 'FINAL_PROFIT' })]);
  const [sess] = await one("select * from game_sessions where status = 'active'");
  assert.equal(sess.current_step, (await c.tv()).step.id);
  assert.equal(Number((await one('select count(*) n from round_results where session_id = $1', [sess.id]))[0].n), 20);
  assert.equal(Number((await one('select count(*) n from responses where session_id = $1', [sess.id]))[0].n), 20);
  const cashDb = await one('select team_no, cash, profit, rank from teams where session_id = $1 order by team_no', [sess.id]);
  const adm = await c.adminState();
  assert.deepEqual(cashDb.map((t) => Number(t.cash)), adm.teams.map((t) => t.cash));
  const lastRound = await one('select team_no, cash_after from round_results where session_id = $1 and round = 4 order by team_no', [sess.id]);
  assert.deepEqual(lastRound.map((t) => Number(t.cash_after)), adm.teams.map((t) => t.cash));
  const social = await one('select category, source, delta, label, team_nos from social_events where session_id = $1 order by sequence', [sess.id]);
  assert.equal(100 + social.reduce((a, e) => a + e.delta, 0), adm.social.score);
  assert.equal(sess.social_score, adm.social.score);
  assert.ok(social.some((e) => e.category === 'consumer' && e.source === 'exaggerated' && e.delta === -20 && e.label === '과장 광고'));
  const [pulse] = await one("select * from session_pulse where slot = 'main'");
  assert.equal(pulse.session_id, sess.id);
  assert.equal(Number(pulse.revision), Number(sess.revision));
  assert.ok(Number((await one("select count(*) n from game_sessions where status = 'archived'"))[0].n) >= 3, '이전 세션은 보관(섞이지 않음)');
  const tokenCol = await one('select claim_token_hash from teams where session_id = $1 and team_no = 1', [sess.id]);
  assert.notEqual(tokenCol[0].claim_token_hash, tokens[1], 'DB 에는 토큰 원문이 아니라 해시만');
  console.log('  ✓ 정규화 테이블: 결과 20행·제출 20행·사회 이벤트·팀 돈이 엔진 상태와 일치, 이전 세션 보관');

  // DB 이중 안전장치: 오래된 revision 저장 거부 / 이미 계산된 결과 변경·삭제 거부
  const saveRaw = (p) => store.save(p);
  const cur = (await store.load({})).session;
  await assert.rejects(saveRaw({ session_id: cur.id, expected_session_id: cur.id, expected_revision: cur.revision - 1, state: cur.state, meta: {} }), /REVISION_CONFLICT/);
  const rows = await one('select team_no, round, units, price, revenue, spent, cash_before, cash_after, profit_before, profit_after, rank_before, rank_after from round_results where session_id = $1', [sess.id]);
  const tampered = rows.map((r) => ({ ...r, cash_after: r.team_no === 1 && r.round === 4 ? Number(r.cash_after) + 999 : Number(r.cash_after), revenue: Number(r.revenue) }));
  await assert.rejects(saveRaw({ session_id: cur.id, expected_session_id: cur.id, expected_revision: cur.revision, state: cur.state, meta: {}, round_results: tampered }), /ROUND_RESULT_MISMATCH/);
  await assert.rejects(saveRaw({ session_id: cur.id, expected_session_id: cur.id, expected_revision: cur.revision, state: cur.state, meta: {}, round_results: [] }), /ROUND_RESULT_REMOVED/);
  assert.equal(Number((await store.load({})).session.revision), Number(cur.revision), '거부된 저장은 아무것도 바꾸지 않음');
  // UNIQUE(session_id, team_id, round)
  await assert.rejects(db.query('insert into responses (session_id, team_id, team_no, round, choice, reason) select session_id, team_id, team_no, round, choice, reason from responses where session_id = $1 limit 1', [sess.id]), /duplicate key/);
  console.log('  ✓ DB 안전장치: 오래된 revision 거부 · 계산된 결과 변경/삭제 거부 · UNIQUE 제약');

  // RLS: 브라우저(anon)는 session_pulse 만 읽기 가능
  const asAnon = (sql) => db.transaction(async (tx) => {
    await tx.query('set local role anon');
    return tx.query(sql);
  });
  for (const t of ['game_sessions', 'teams', 'responses', 'round_results', 'social_events', 'reflections', 'team_presence']) {
    await assert.rejects(asAnon(`select * from public.${t}`), /permission denied/, `anon 이 ${t} 를 읽을 수 있음`);
  }
  assert.equal((await asAnon('select session_id, revision, step_id from public.session_pulse')).rows.length, 1);
  await assert.rejects(asAnon("update public.session_pulse set revision = 0"), /permission denied/);
  await assert.rejects(asAnon("select public.slangi_save('{}'::jsonb)"), /permission denied/);
  await assert.rejects(asAnon("select public.slangi_load('{}'::jsonb)"), /permission denied/);
  console.log('  ✓ RLS/권한: anon 은 session_pulse 읽기만, 데이터 테이블·RPC 접근 불가');

  console.log('\nDB 통합 테스트 통과');
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  for (const s of servers) s.close();
  await db.close();
}
