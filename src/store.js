// 게임 상태 저장소
//   SupabaseStore : 운영(Vercel). PostgREST RPC 로 slangi_load / slangi_save 호출. 의존성 없음(fetch).
//   MemoryStore   : 로컬 개발·테스트용 (프로세스를 끄면 사라짐). 같은 규칙(revision 비교)으로 동작.

export class ConflictError extends Error {}
export class StoreError extends Error {}

const clone = (x) => (x == null ? x : JSON.parse(JSON.stringify(x)));

export class MemoryStore {
  constructor() {
    this.session = null; // { id, revision, state }
    this.archived = [];
    this.presence = new Map(); // `${sid}:${team}:${client}` → ms
  }

  async load({ tokenHash, clientId, presence = false, windowMs = 20_000 } = {}) {
    const s = this.session;
    if (!s) return { session: null, presence: [] };
    if (tokenHash && clientId) {
      const t = Object.values(s.state.teams).find((x) => x.tokenHash === tokenHash);
      if (t) this.presence.set(`${s.id}:${t.id}:${String(clientId).slice(0, 64)}`, Date.now());
    }
    const counts = {};
    if (presence) {
      for (const [k, at] of this.presence) {
        const [sid, team] = k.split(':');
        if (sid === s.id && Date.now() - at < windowMs) counts[team] = (counts[team] || 0) + 1;
      }
    }
    return {
      session: clone(s),
      presence: Object.entries(counts).map(([team, n]) => ({ team_no: Number(team), clients: n })),
    };
  }

  async save(p) {
    const cur = this.session;
    const isNew = !p.expected_session_id || p.session_id !== p.expected_session_id;
    if (isNew) {
      if (!p.expected_session_id ? !!cur : !cur || cur.id !== p.expected_session_id || cur.revision !== p.expected_revision) {
        throw new ConflictError('REVISION_CONFLICT');
      }
      if (cur) this.archived.push(cur);
      this.session = { id: p.session_id, revision: 1, state: clone(p.state) };
    } else {
      if (!cur || cur.id !== p.session_id || cur.revision !== p.expected_revision) throw new ConflictError('REVISION_CONFLICT');
      this.session = { id: cur.id, revision: cur.revision + 1, state: clone(p.state) };
    }
    return { session_id: this.session.id, revision: this.session.revision };
  }
}

export class SupabaseStore {
  constructor(url, serviceKey, { fetchImpl = globalThis.fetch, timeoutMs = 9000 } = {}) {
    this.url = String(url).replace(/\/+$/, '');
    this.key = serviceKey;
    this.fetch = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  async rpc(fn, p) {
    const headers = { 'Content-Type': 'application/json', apikey: this.key };
    // 예전 JWT 형식(service_role) 키는 Authorization 에도 넣음. 새 sb_secret_ 키는 apikey 헤더만 사용.
    if (!String(this.key).startsWith('sb_')) headers.Authorization = `Bearer ${this.key}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    let res;
    try {
      res = await this.fetch(`${this.url}/rest/v1/rpc/${fn}`, { method: 'POST', headers, body: JSON.stringify({ p }), signal: ctrl.signal });
    } catch (e) {
      throw new StoreError(`Supabase 연결 실패: ${e.message}`);
    } finally {
      clearTimeout(timer);
    }
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch { /* noop */ }
    if (!res.ok) {
      const msg = data?.message || text || `HTTP ${res.status}`;
      // 동시에 들어온 요청 중 늦은 쪽: 최신 상태로 다시 시도하면 됨
      if (/REVISION_CONFLICT/.test(msg) || data?.code === '23505') throw new ConflictError(msg);
      throw new StoreError(`Supabase 오류 (${fn}): ${msg}`);
    }
    return data;
  }

  async load({ tokenHash, clientId, presence = false, windowMs = 20_000 } = {}) {
    const r = await this.rpc('slangi_load', {
      token_hash: tokenHash || null,
      client_id: clientId || null,
      presence,
      window_s: windowMs / 1000,
    });
    return { session: r?.session ?? null, presence: r?.presence ?? [] };
  }

  async save(p) {
    return this.rpc('slangi_save', p);
  }
}

// 환경변수로 저장소 선택. 운영(Vercel)에서 Supabase 설정이 없으면 메모리로 몰래 대체하지 않고 오류를 냄.
export function storeFromEnv(env = process.env, { allowMemory = false } = {}) {
  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) return new SupabaseStore(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  if (allowMemory) return new MemoryStore();
  return null;
}
