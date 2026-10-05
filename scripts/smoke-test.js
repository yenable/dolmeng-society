// 서버 통합 테스트 (메모리 저장소): 로컬 서버를 띄워 HTTP API 로 한 판 전체를 진행합니다.
// node scripts/smoke-test.js      — Supabase SQL 까지 포함한 테스트는 scripts/db-test.js
import { startDevServer } from './dev-server.js';
import { runFlow, PIN } from './lib/flow.js';

process.env.ADMIN_PIN = PIN;
const { MemoryStore } = await import('../src/store.js');
const store = new MemoryStore();
const servers = [];
const start = async () => {
  const s = await startDevServer({ port: 0, store, env: {} });
  servers.push(s.server);
  return `http://127.0.0.1:${s.port}`;
};

try {
  console.log('서버 통합 테스트 (메모리 저장소)');
  await runFlow(await start(), { restart: start });
  console.log('\n통합 테스트 통과');
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  for (const s of servers) s.close();
}
