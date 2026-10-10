// 세 화면 공통: 실시간 연결(SSE, 자동 재연결), API 호출, 숫자 표시, 애니메이션

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const fmt = (n) => Math.round(Number(n) || 0).toLocaleString('ko-KR');
export const won = (n) => `${fmt(n)}원`;
export const signedWon = (n) => `${n >= 0 ? '+' : '−'}${won(Math.abs(n))}`;
export const signed = (n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${fmt(Math.abs(n))}`;
export const medal = (rank) => ({ 1: '🥇', 2: '🥈', 3: '🥉' })[rank] ?? '';
export const rankText = (rank) => (rank ? `${rank}위` : '-');

// ── 실시간 상태 구독 ───────────────────────────────────────────────
//  · Supabase Realtime 으로 '변경 신호'(session_pulse)를 받으면 곧바로 서버에서 화면 데이터를 다시 받음
//  · 신호와 상관없이 몇 초마다 한 번씩도 확인 (Realtime 이 막히거나 끊겨도 상태가 어긋나지 않음)
//  · 네트워크 오류는 '연결 끊김'으로만 알림. 토큰/기업 선택은 절대 건드리지 않음
const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

export function connectLive({ role, headers = () => ({}) }, { onState, onStatus, onAuthError }) {
  let closed = false;
  let inflight = false;
  let again = false;
  let timer = null;
  let fails = 0;
  let realtimeOk = false;
  let channel = null;

  const status = (s) => onStatus?.(s);

  async function refresh() {
    if (closed) return;
    if (inflight) {
      again = true;
      return;
    }
    inflight = true;
    clearTimeout(timer);
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await fetch(`/api/state?role=${role}`, { headers: headers(), cache: 'no-store', signal: ctrl.signal });
      if (res.status === 401 && onAuthError) {
        onAuthError();
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      fails = 0;
      status('online');
      onState(data);
    } catch {
      fails += 1;
      if (fails >= 2) status('offline');
    } finally {
      clearTimeout(t);
      inflight = false;
      if (again) {
        again = false;
        refresh();
      } else schedule();
    }
  }

  function schedule() {
    clearTimeout(timer);
    if (closed) return;
    // 실패 중이면 2초마다 재시도, Realtime 이 살아 있으면 5초, 아니면 2초
    timer = setTimeout(refresh, fails ? 2000 : realtimeOk ? 5000 : 2000);
  }

  async function startRealtime(delay = 0) {
    if (delay) await new Promise((r) => setTimeout(r, delay));
    if (closed) return;
    try {
      const cfg = await (await fetch('/api/config', { cache: 'no-store' })).json();
      if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) return; // Realtime 없이 polling 만
      const { createClient } = await import(SUPABASE_JS);
      const sb = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { persistSession: false, autoRefreshToken: false } });
      channel = sb
        .channel(`slangi-${role}-${Math.random().toString(36).slice(2, 8)}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'session_pulse' }, () => refresh())
        .subscribe((st) => {
          const ok = st === 'SUBSCRIBED';
          if (ok && !realtimeOk) refresh(); // 다시 연결되면 놓친 변경을 바로 확인
          realtimeOk = ok;
        });
    } catch {
      realtimeOk = false;
      startRealtime(15_000); // CDN·설정 불러오기 실패: 잠시 뒤 다시 시도 (그동안 polling 으로 동작)
    }
  }

  const wake = () => {
    if (!document.hidden) refresh();
  };
  document.addEventListener('visibilitychange', wake);
  window.addEventListener('online', wake);
  window.addEventListener('pageshow', wake);
  window.addEventListener('focus', wake);

  refresh();
  startRealtime();
  return {
    refresh,
    close() {
      closed = true;
      clearTimeout(timer);
      try {
        channel?.unsubscribe();
      } catch { /* noop */ }
    },
  };
}

// 학생 화면용 작은 연결 상태 표시: 연결됨 / 끊김(다시 연결 중) / 다시 연결되었습니다
export function connBadge(status) {
  let el = $('#linkstate');
  if (!el) {
    el = document.createElement('div');
    el.id = 'linkstate';
    el.className = 'linkstate';
    document.body.appendChild(el);
  }
  const prev = connBadge.state;
  connBadge.state = status;
  const set = (cls, text) => {
    el.className = `linkstate ${cls}`;
    el.innerHTML = text.replace(/^●/, '<i class="d">●</i>');
  };
  if (status === 'offline') {
    clearTimeout(connBadge.t);
    set('off', '● 연결이 잠시 끊겼어요. 다시 연결하는 중…');
  } else if (status === 'recovered' || (status === 'online' && prev === 'offline')) {
    clearTimeout(connBadge.t);
    set('ok recovered', '✓ 다시 연결되었습니다.');
    connBadge.state = 'online';
    connBadge.t = setTimeout(() => set('ok', '● 연결됨'), 3000);
  } else if (status === 'online' && !el.classList.contains('recovered')) {
    set('ok', '● 연결됨');
  }
}

export async function api(path, body = {}, headers = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  let res;
  try {
    res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch {
    throw Object.assign(new Error('인터넷 연결을 확인하고 다시 시도해 주세요.'), { status: 0 });
  } finally {
    clearTimeout(timer);
  }
  let data = {};
  try {
    data = await res.json();
  } catch { /* noop */ }
  if (!res.ok) throw Object.assign(new Error(data.error || '오류가 발생했습니다.'), { status: res.status });
  return data;
}

let toastTimer;
export function toast(msg, { error = false, ms = 2800 } = {}) {
  let el = $('#toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.toggle('error', error);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

export function netBanner(status) {
  let el = $('#net');
  if (!el) {
    el = document.createElement('div');
    el.id = 'net';
    el.className = 'net';
    el.textContent = '연결이 잠시 끊겼어요. 다시 연결하는 중…';
    document.body.appendChild(el);
  }
  clearTimeout(netBanner.t);
  // 잠깐의 끊김은 표시하지 않음
  if (status === 'offline') netBanner.t = setTimeout(() => el.classList.add('show'), 1500);
  else el.classList.remove('show');
}

// 숫자 카운트 애니메이션
export function animateNumber(el, from, to, { duration = 1200, format = fmt } = {}) {
  if (!el) return;
  const start = performance.now();
  cancelAnimationFrame(el._raf);
  const tick = (now) => {
    const t = Math.min(1, (now - start) / duration);
    const e = 1 - Math.pow(1 - t, 3);
    el.textContent = format(from + (to - from) * e);
    if (t < 1) el._raf = requestAnimationFrame(tick);
  };
  el.textContent = format(from);
  el._raf = requestAnimationFrame(tick);
}

// 상자 안에 글자가 다 들어가도록 글자 크기를 줄임
export function fitText(el, { max = 40, min = 12 } = {}) {
  if (!el) return;
  let lo = min;
  let hi = max;
  el.style.fontSize = `${hi}px`;
  if (el.scrollHeight <= el.clientHeight + 1 && el.scrollWidth <= el.clientWidth + 1) return;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    el.style.fontSize = `${mid}px`;
    if (el.scrollHeight <= el.clientHeight + 1 && el.scrollWidth <= el.clientWidth + 1) lo = mid;
    else hi = mid;
  }
  el.style.fontSize = `${lo}px`;
}

export const storage = {
  get(k) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, v);
    } catch { /* noop */ }
  },
  del(k) {
    try {
      localStorage.removeItem(k);
    } catch { /* noop */ }
  },
};

// 한국어 조사 (받침 유무) — 서버 src/josa.js 와 같은 규칙
export function josa(word, type) {
  const s = String(word).trim();
  const code = s.charCodeAt(s.length - 1);
  let jong = 0;
  if (code >= 0xac00 && code <= 0xd7a3) jong = (code - 0xac00) % 28;
  else if (/[013678]$/.test(s)) jong = 1;
  const has = jong !== 0;
  return ({
    이: has ? '이' : '가', 을: has ? '을' : '를', 은: has ? '은' : '는', 과: has ? '과' : '와', 으로: has && jong !== 8 ? '으로' : '로',
  })[type] ?? '';
}
export const withJosa = (word, type) => `${word}${josa(word, type)}`;

// ── 기업 회의 타이머 (학생·TV·교사 공통) ─────────────────────────────
//  기준은 서버 상태: 서버가 보낸 남은 시간(leftMs)을 받은 순간부터 이 화면에서만 줄여 보여줌.
//  새로고침·재접속하면 서버에서 다시 받으므로 세 화면이 같은 시간을 봄. 0이 되어도 아무것도 제출하지 않음.
export const clockText = (ms) => {
  const s = Math.ceil(Math.max(0, ms) / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

// 화면에 넣는 자리. 숫자는 meetingTimer() 가 채움
export const timerHtml = (cls = '', label = '남은 시간') =>
  `<div class="mtimer ${cls}" data-timer hidden><span class="tm-ic" aria-hidden="true">⏱</span><span class="tm-k">${label}</span><b class="tm-v num">--:--</b><span class="tm-note"></span></div>`;

export function meetingTimer() {
  let t = null;
  let at = 0;
  const left = () => (!t ? null : t.paused ? t.leftMs : Math.max(0, t.leftMs - (performance.now() - at)));
  function paint() {
    const ms = left();
    for (const el of $$('[data-timer]')) {
      el.hidden = ms == null;
      if (ms == null) continue;
      const v = $('.tm-v', el);
      const text = clockText(ms);
      if (v.textContent !== text) v.textContent = text;
      const over = ms <= 0;
      el.classList.toggle('low', !over && ms <= 30_000);
      el.classList.toggle('over', over);
      el.classList.toggle('paused', !!t.paused);
      $('.tm-note', el).textContent = over ? '시간 종료' : t.paused ? '일시정지' : '';
    }
  }
  setInterval(paint, 250);
  return {
    set(timer) {
      t = timer ?? null;
      at = performance.now();
      paint();
    },
    paint,
  };
}
