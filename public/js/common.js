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

// 실시간 상태 구독. 끊기면 자동으로 다시 연결합니다.
export function connectStream(params, { onState, onStatus, onFatal }) {
  let es = null;
  let lastMsg = Date.now();
  let closed = false;
  let retryTimer = null;

  const status = (s) => onStatus?.(s);
  function open() {
    if (closed) return;
    es = new EventSource(`/events?${new URLSearchParams(params)}`);
    es.addEventListener('state', (e) => {
      lastMsg = Date.now();
      status('online');
      let data;
      try {
        data = JSON.parse(e.data);
      } catch {
        return;
      }
      onState(data);
    });
    es.addEventListener('ping', () => {
      lastMsg = Date.now();
      status('online');
    });
    es.onerror = () => {
      status('offline');
      if (es.readyState === EventSource.CLOSED) {
        clearTimeout(retryTimer);
        retryTimer = setTimeout(reopen, 2000);
        onFatal?.();
      }
    };
  }
  function reopen() {
    if (closed) return;
    try {
      es?.close();
    } catch { /* noop */ }
    open();
  }
  const watchdog = setInterval(() => {
    if (Date.now() - lastMsg > 40_000) {
      lastMsg = Date.now();
      status('offline');
      reopen();
    }
  }, 5000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Date.now() - lastMsg > 20_000) reopen();
  });
  window.addEventListener('online', reopen);
  open();
  return {
    close() {
      closed = true;
      clearInterval(watchdog);
      es?.close();
    },
    reconnect: reopen,
  };
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
