// 교실 TV 화면 /display — 교사가 /admin 에서 진행하면 자동으로 바뀝니다. (기본은 보기 전용)
// /display?presenter=1 : 교사 PIN 입력 후 PPT 프레젠터 리모컨(키보드)으로 앞뒤 진행
import { $, $$, esc, won, signedWon, signed, medal, connectLive, netBanner, animateNumber, fitText, api } from './common.js';
import { unlockAudio, setMuted, typeClick, newsSting, bell } from './sfx.js';

const params = new URLSearchParams(location.search);
const PREVIEW = params.has('preview'); // 어드민 미리보기용 (음소거, 조작 없음)
const PRESENTER = params.get('presenter') === '1' && !PREVIEW;
const stage = $('#stage');
let view = null;
let lastKey = '';
let live = null;

const remPx = () => parseFloat(getComputedStyle(document.documentElement).fontSize);
setMuted(PREVIEW);

// ── 시작 버튼: 한 번 클릭하면 전체화면 + 이후 효과음 재생이 허용됨 ─────────────
const starter = $('#starter');
if (!PREVIEW) {
  if (!PRESENTER) starter.classList.remove('hidden');
  starter.addEventListener('click', (e) => {
    e.stopPropagation();
    starter.classList.add('hidden');
    unlockAudio();
    document.documentElement.requestFullscreen?.().catch(() => {});
  });
  document.addEventListener('click', () => {
    unlockAudio();
    starter.classList.add('hidden');
  });
  document.addEventListener('dblclick', () => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.().catch(() => {});
  });
}

live = connectLive({ role: 'display' }, { onState, onStatus: PREVIEW ? () => {} : netBanner });

function onState(v) {
  if (view && v.sessionId === view.sessionId && v.rev < view.rev) return;
  const prev = view;
  view = v;
  const k = v.step.kind;
  // 화면을 다시 그릴지 결정하는 키 (접속·제출 수 같은 작은 변화는 다시 그리지 않고 갱신만)
  const key = JSON.stringify({
    ...v, rev: 0, serverTime: 0,
    submittedCount: ['meeting', 'reflection'].includes(k) ? 0 : v.submittedCount,
    submittedTeams: 0,
    companies: 0,
  });
  if (key !== lastKey) {
    lastKey = key;
    cancelTyping();
    render(v, prev);
  }
  updateLive(v);
}

// ── 타이핑 효과 (뉴스 제목) ─────────────────────────────
let typeSeq = 0;
const cancelTyping = () => {
  typeSeq += 1;
};
function typeText(el, text, { cps = 11, sound = true } = {}) {
  const my = typeSeq;
  const chars = [...text];
  el.textContent = '';
  el.classList.add('typing');
  return new Promise((resolve) => {
    let i = 0;
    const tick = () => {
      if (my !== typeSeq || !el.isConnected) return resolve(false);
      i += 1;
      el.textContent = chars.slice(0, i).join('');
      const ch = chars[i - 1];
      if (sound && ch.trim()) typeClick();
      if (i >= chars.length) {
        el.classList.remove('typing');
        if (sound) bell();
        return resolve(true);
      }
      const base = 1000 / cps;
      setTimeout(tick, base * (ch === ' ' ? 1.5 : /[.…,!?]/.test(ch) ? 2.2 : 0.75 + Math.random() * 0.5));
    };
    setTimeout(tick, 1000 / cps);
  });
}
const later = (ms) => new Promise((r) => setTimeout(r, ms));

function topbar(v, right = '') {
  return `<div class="topbar"><div class="brand"><i></i>돌멩민국 슬랑이 시장</div>${right ? `<div class="pill">${right}</div>` : ''}</div>`;
}

function render(v, prev) {
  const k = v.step.kind;
  const special = v.roundInfo?.special && ['scene', 'meeting', 'responses', 'result'].includes(k);
  document.body.className = `display ${v.step.dark ? 'dark' : 'light'} ${special ? 'special' : ''} kind-${k}`;
  const r = RENDER[k] ?? RENDER.intro;
  r(v, prev);
}

const roundPill = (v) => `ROUND ${v.roundInfo.round} · ${esc(v.roundInfo.title)}`;

const RENDER = {
  intro(v) {
    stage.innerHTML = `
      ${topbar(v)}
      <div class="center">
        <h1 class="intro-title fade-up">돌멩민국 슬랑이 시장</h1>
        <p class="intro-sub fade-up">5개 기업의 대표가 되어 우리 기업의 이윤을 높여 보세요!</p>
        <div class="company-row" id="companies"></div>
      </div>`;
  },

  scene(v) {
    const ri = v.roundInfo;
    const opts = `<div class="scene-opts" style="--cols:${ri.options.length}">
      ${ri.options.map((o, i) => `<div class="scene-opt fade-up" style="animation-delay:${0.4 + i * 0.15}s"><b>${esc(o.label)}</b>
        ${o.cost ? `<span class="cost">비용 ${won(o.cost)}</span>` : ''}<p>${esc(o.desc)}</p></div>`).join('')}</div>`;
    if (ri.special) {
      stage.innerHTML = `${topbar(v, 'ROUND 4')}
        <div class="center special"><div class="envelope">
          <div class="seal">🔒 슬랑이 기업 공동 제안</div>
          <div class="situation" style="margin-top:2rem">${ri.situation.map((l) => `<p>${esc(l)}</p>`).join('')}</div>
          <div class="ask">${esc(ri.question)}</div>
        </div></div>`;
      return;
    }
    stage.innerHTML = `${topbar(v, roundPill(v))}
      <div class="center">
        <div class="round-label fade-up">ROUND ${ri.round}</div>
        <h1 class="round-title fade-up">${esc(ri.question)}</h1>
        <div class="situation fade-up">${ri.situation.map((l) => `<p>${esc(l)}</p>`).join('')}</div>
        ${opts}
      </div>`;
  },

  meeting(v) {
    const ri = v.roundInfo;
    stage.innerHTML = `${topbar(v, roundPill(v))}
      <div class="center ${ri.special ? 'special' : ''}">
        <h1 class="meeting-title">기업 회의 중<span class="dots"></span></h1>
        <p class="meeting-q">${esc(ri.question)}</p>
        <div class="meeting-count"><b id="cnt">${v.submittedCount}</b> / ${v.totalTeams} 기업 결정 완료</div>
        <div class="company-row" id="companies"></div>
      </div>`;
  },

  responses(v) {
    renderResponsesTable(v, `${v.roundInfo.round}라운드 · 모둠별 선택과 이유`, v.roundInfo.special ? '공동 제안에 대한 선택' : esc(v.roundInfo.question));
  },

  result(v) {
    const ri = v.roundInfo;
    if (!v.results) return RENDER.responses(v);
    const round = ri.round;
    const spentLabel = round === 2 ? '광고비' : round === 3 ? '생산비' : '';
    const col = v.collusion;
    stage.innerHTML = `${topbar(v, roundPill(v))}
      <div class="table-title">${round}라운드 시장 결과 <small>이번 라운드에 팔린 슬랑이</small></div>
      ${col ? `<div class="col-banner">공동 제안 참여 <b>${col.count} / ${col.total}</b> 기업
        ${col.members.map((m) => `<span class="cdot" style="--c:${m.color}"></span>${esc(m.name)}`).join(' ')}</div>` : ''}
      <div class="result-grid">
        ${v.results.map((r, i) => `
          <div class="rcard" style="--c:${r.color}; animation-delay:${i * 0.12}s">
            <div class="nm">${esc(r.name)}</div>
            ${r.member ? '<span class="tag">🔒 공동 가격</span>' : ''}
            <div><div class="k">판매 가격</div><div class="v num">${won(r.price)}</div></div>
            <div><div class="k">판매량</div><div class="units num"><span data-units="${r.units}">0</span><small>개</small></div></div>
            <div class="grow"></div>
            <div><div class="k">이번 라운드 판 돈</div><div class="rev num" data-rev="${r.revenue}">+0원</div></div>
            ${spentLabel && r.spent ? `<div class="spent num">${spentLabel} −${won(r.spent)}</div>` : ''}
          </div>`).join('')}
      </div>`;
    $$('[data-units]').forEach((el, i) => setTimeout(() => animateNumber(el, 0, Number(el.dataset.units), { duration: 1400 }), 300 + i * 120));
    $$('[data-rev]').forEach((el, i) => setTimeout(() => animateNumber(el, 0, Number(el.dataset.rev), { duration: 1600, format: (n) => `+${won(n)}` }), 500 + i * 120));
  },

  rank(v) {
    const st = v.standings;
    if (!st) return RENDER.responses(v);
    stage.innerHTML = `${topbar(v, roundPill(v))}
      <div class="table-title">${v.roundInfo.round}라운드 후 이윤 순위 <small>이윤 = 현재 가진 돈 − 시작 자금</small></div>
      <div class="rank-board" id="board"></div>`;
    const board = $('#board');
    const hasBefore = st.some((x) => x.rankBefore);
    const beforeOrder = [...st].sort((a, b) => (a.rankBefore ?? 9) - (b.rankBefore ?? 9) || a.teamId - b.teamId).map((x) => x.teamId);
    const afterOrder = st.map((x) => x.teamId);
    const beforeProfit = {};
    for (const r of v.results ?? []) beforeProfit[r.teamId] = r.profitBefore;
    board.innerHTML = st.map((x) => {
      const d = x.rankBefore ? x.rankBefore - x.rank : 0;
      const chg = !x.rankBefore ? '' : d > 0 ? `<span class="chg up">▲ ${d}</span>` : d < 0 ? `<span class="chg down">▼ ${-d}</span>` : '<span class="chg same">–</span>';
      return `<div class="rank-row" data-team="${x.teamId}" style="--c:${x.color}">
        <span class="rk">${hasBefore ? `${x.rankBefore}위` : ''}</span><span class="nm">${esc(x.name)}</span>
        <span class="pf num" data-to="${x.profit}" data-from="${beforeProfit[x.teamId] ?? 0}">${signedWon(beforeProfit[x.teamId] ?? 0)}</span>${chg || '<span></span>'}</div>`;
    }).join('');
    const place = (order) => order.forEach((id, i) => { const row = $(`.rank-row[data-team="${id}"]`, board); if (row) row.style.top = `${i * 20}%`; });
    place(hasBefore ? beforeOrder : afterOrder);
    setTimeout(() => {
      $$('.pf', board).forEach((el) => animateNumber(el, Number(el.dataset.from), Number(el.dataset.to), { duration: 1000, format: signedWon }));
    }, 500);
    setTimeout(() => {
      place(afterOrder);
      st.forEach((x) => {
        const row = $(`.rank-row[data-team="${x.teamId}"]`, board);
        $('.rk', row).innerHTML = `${medal(x.rank) ? `<span class="md">${medal(x.rank)}</span>` : ''}${x.rank}위`;
        row.classList.toggle('first', x.rank === 1);
      });
      board.classList.add('settled');
    }, hasBefore ? 1700 : 600);
  },

  final(v) {
    const st = v.standings;
    const [a, b, c, ...rest] = st;
    const pod = (x, cls) => x ? `<div class="pod ${cls}" style="--c:${x.color}">
      <div class="md">${medal(x.rank) || `${x.rank}위`}</div><div class="nm">${esc(x.name)}</div>
      <div class="pf num">${signedWon(x.profit)}</div>${cls === 'p1' ? '<div class="cheer">축하합니다! 🎉</div>' : ''}</div>` : '<div></div>';
    stage.innerHTML = `${topbar(v, '최종 결과')}
      <div class="final-head"><div class="sub">돌멩민국 슬랑이 시장</div><h1>최종 기업 이윤 순위</h1></div>
      <div class="podium">${pod(b, 'p2')}${pod(a, 'p1')}${pod(c, 'p3')}</div>
      <div class="rest">${rest.map((x) => `<div class="rr" style="--c:${x.color}"><span>${x.rank}위</span><span>${esc(x.name)}</span><span class="num">${signedWon(x.profit)}</span></div>`).join('')}</div>`;
    confetti();
  },

  blackout() {
    stage.innerHTML = `<div class="center">
      <p class="blackout-1">하지만…</p>
      <p class="blackout-2">기업의 선택은<br>기업 안에서만 끝나지 않았습니다.</p></div>`;
  },

  // 뉴스: 장면 1 = 속보 시그널 + 제목 타이핑, 장면 2(다음 클릭) = 기사 내용
  news(v, prev) {
    const n = v.news;
    if (!n) {
      stage.innerHTML = '<div class="center"></div>';
      return;
    }
    const sameStep = prev && prev.sessionId === v.sessionId && prev.step.id === v.step.id && $('.news h1', stage);
    const detailHtml = () => `
      <div class="lines">${n.lines.map((l) => `<p>${esc(l)}</p>`).join('')}</div>
      <div class="chips">${n.companies.map((c) => `<span class="chip"><span class="cdot" style="--c:${c.color}"></span>${esc(c.name)} <small>${esc(c.note)}</small></span>`).join('')}</div>`;
    const tickerText = `돌멩민국 경제뉴스 · ${esc(n.headline)}${n.lines[0] ? ` · ${esc(n.lines[0])}` : ''}`;
    if (sameStep) {
      // 같은 뉴스 안에서 제목 ↔ 기사 내용만 바꿈 (제목을 다시 타이핑하지 않음)
      const h1 = $('.news h1', stage);
      h1.classList.remove('typing');
      h1.textContent = n.headline;
      $('#news-detail').innerHTML = v.newsDetail ? detailHtml() : '';
      $('#news-detail').classList.toggle('now', !!v.newsDetail);
      $('.ticker span', stage).innerHTML = tickerText;
      return;
    }
    stage.innerHTML = `${topbar(v, '돌멩민국 경제뉴스')}
      <div class="news">
        <div class="tagline"><span class="live">속보</span><span>[${esc(n.tag)}]</span><span class="cat">${esc(n.category)}</span></div>
        <h1 class="typed">${v.newsDetail ? esc(n.headline) : ''}</h1>
        <div id="news-detail">${v.newsDetail ? detailHtml() : ''}</div>
      </div>
      <div class="ticker"><span>${tickerText}</span></div>`;
    if (!v.newsDetail) {
      // 처음 들어온 뉴스: 속보 시그널 → 제목 타이핑
      newsSting();
      later(700).then(() => typeText($('.news h1', stage), n.headline));
    }
  },

  // 사회면: 영상 대신 신문 사회면 슬라이드. 오늘의 주요 기사 제목이 차례로 타이핑됨
  async paper(v) {
    const heads = v.headlines ?? [];
    const d = new Date();
    stage.innerHTML = `${topbar(v, '돌멩일보 사회면')}
      <div class="paper-wrap"><article class="paper">
        <header class="masthead">
          <div class="mh-side">제 1 호</div>
          <div class="mh-title">돌멩일보</div>
          <div class="mh-side">${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일</div>
        </header>
        <div class="section-bar"><span>사회</span><span>오늘의 주요 소식</span></div>
        <div class="paper-body">
          ${heads.length
            ? heads.map((h, i) => `<section class="article ${i === 0 ? 'lead' : ''}"><span class="kicker">${esc(h.category)}</span><h2 data-head="${esc(h.headline)}"></h2></section>`).join('')
            : '<section class="article lead"><span class="kicker">사회</span><h2 data-head="오늘 돌멩민국 슬랑이 시장에는 큰 사건이 없었습니다."></h2></section>'}
        </div>
      </article></div>`;
    const my = typeSeq;
    newsSting();
    await later(800);
    for (const h of $$('.paper h2[data-head]', stage)) {
      if (my !== typeSeq) return;
      h.closest('.article').classList.add('in');
      await typeText(h, h.dataset.head, { cps: 13 });
      await later(500);
    }
  },

  score(v, prev) {
    const sc = v.score;
    const items = sc.items;
    const cur = items.length ? items[items.length - 1].after : sc.start;
    const isStep = prev && prev.step.id === v.step.id && prev.score && prev.score.revealIndex === sc.revealIndex - 1;
    // 감점 항목이 하나 새로 나온 장면 (최종 장면에서는 숫자를 다시 깎지 않음)
    const newest = isStep && items.length && sc.revealIndex <= sc.total ? items[items.length - 1] : null;
    const finalNow = isStep && sc.done;
    stage.innerHTML = `${topbar(v, '사회적 영향')}
      <div class="score ${sc.done ? 'is-final' : ''}">
        <div class="score-left">
          <div class="lbl">돌멩민국 사회점수</div>
          <div class="score-num num ${cur < 0 ? 'neg' : ''} ${finalNow ? 'final-pop' : ''}" id="snum">${signed(newest ? newest.before : cur).replace('+', '')}</div>
          <div class="final ${sc.done ? 'show' : ''}">최종 사회점수</div>
        </div>
        <div class="score-items ${sc.total > 8 ? 'dense' : sc.total > 5 ? 'compact' : ''}">
          ${sc.total === 0 && sc.done ? '<div class="score-none">기업들의 선택으로 줄어든 사회점수가 없습니다.</div>' : ''}
          ${items.map((it, i) => `
            <div class="sitem ${newest && i === items.length - 1 ? 'new' : ''}">
              <span class="ct ${it.category}">${esc(it.categoryLabel)}</span>
              <span class="tt">${esc(it.title)}${it.companies.length ? `<small>${it.companies.map((c) => esc(c.name)).join(', ')}</small>` : ''}</span>
              <span class="dl num">${signed(it.delta)}</span>
            </div>`).join('')}
        </div>
      </div>`;
    if (newest) {
      const el = $('#snum');
      setTimeout(() => {
        el.classList.add('hit');
        animateNumber(el, newest.before, newest.after, {
          duration: 1400,
          format: (n) => {
            const r = Math.round(n);
            el.classList.toggle('neg', r < 0);
            return r < 0 ? `−${Math.abs(r)}` : String(r);
          },
        });
      }, 700);
    } else {
      $('#snum').textContent = cur < 0 ? `−${Math.abs(cur)}` : String(cur);
    }
  },

  reflection(v) {
    stage.innerHTML = `${topbar(v, '정리')}
      <div class="center">
        <div class="round-label">정리</div>
        <h1 class="refl-title">다시 경영한다면?</h1>
        <p class="refl-q">우리 기업의 선택 중 하나를 바꾼다면?</p>
        <div class="meeting-count"><b id="cnt">${v.submittedCount}</b> / ${v.totalTeams} 기업 제출 완료</div>
        <div class="company-row" id="companies"></div>
      </div>`;
  },

  reflectionResponses(v) {
    const rows = v.reflections;
    stage.innerHTML = `${topbar(v, '정리')}
      <div class="table-title">다시 경영한다면? <small>바꾸고 싶은 선택과 그 이유</small></div>
      <div class="resp refl">
        ${rows.map((r, i) => `
          <div class="resp-row ${r.submitted ? '' : 'missing'}" style="--c:${r.color}; animation-delay:${i * 0.1}s">
            <div class="who">${esc(r.name)}</div>
            <div class="what">${r.submitted ? `<span class="dec">${esc(r.decisionLabel)}</span><s>${esc(r.fromLabel)}</s> → ${esc(r.toLabel)}` : '미제출'}</div>
            <div class="why"><span>${r.submitted ? `${esc(r.reason)} <b>때문입니다.</b>` : ''}</span></div>
          </div>`).join('')}
      </div>`;
    fitReasons();
  },

  closing(v) {
    stage.innerHTML = `<div class="center closing">${v.closing.map((l) => `<p>${esc(l)}</p>`).join('')}</div>`;
  },
};

function renderResponsesTable(v, title, sub) {
  const pred = !!v.roundInfo.prediction;
  stage.innerHTML = `${topbar(v, roundPill(v))}
    <div class="table-title">${esc(title)} <small>${sub}</small></div>
    <div class="resp ${pred ? 'with-pred' : ''}">
      ${v.responses.map((r, i) => `
        <div class="resp-row ${r.choiceLabel ? '' : 'missing'}" style="--c:${r.color}; animation-delay:${i * 0.1}s">
          <div class="who">${esc(r.name)}</div>
          <div class="what ${r.choice === 'join' ? 'join' : ''}">${r.choiceLabel ? esc(r.choiceLabel) : '미제출'}</div>
          <div class="why"><span>${r.choiceLabel && !r.byDefault ? `${esc(r.reason)} <b>때문입니다.</b>` : r.byDefault ? '(제출하지 않아 기본 선택 적용)' : ''}</span></div>
          ${pred ? `<div class="pred"><small>다른 기업 예상</small>${esc(r.predictionLabel ?? '-')}</div>` : ''}
        </div>`).join('')}
    </div>`;
  fitReasons();
}

function fitReasons() {
  const rem = remPx();
  requestAnimationFrame(() => $$('.resp-row .why').forEach((el) => fitText(el, { max: rem * 2.4, min: rem * 1.1 })));
}

// 다시 그리지 않고 갱신하는 부분 (접속 상태, 제출 수)
function updateLive(v) {
  const cnt = $('#cnt');
  if (cnt) cnt.textContent = v.submittedCount;
  const row = $('#companies');
  if (!row) return;
  const k = v.step.kind;
  const done = new Set(v.submittedTeams ?? []);
  row.innerHTML = v.companies.map((c) => {
    const on = k === 'intro' ? c.connected : done.has(c.id);
    const label = k === 'intro' ? (c.connected ? '✓ 접속' : '대기 중') : on ? '✓ 결정 완료' : '회의 중…';
    return `<div class="company-card ${on ? 'on' : ''}" style="--c:${c.color}"><span class="blob"></span>${esc(c.name)}<small>${label}</small></div>`;
  }).join('');
}

// TV 하단에 잠깐 뜨는 안내 (프레젠터로 넘길 수 없을 때 등)
function tvNotice(lines, ms = 3800) {
  let el = $('#tv-notice');
  if (!el) {
    el = document.createElement('div');
    el.id = 'tv-notice';
    el.className = 'tv-notice';
    document.body.appendChild(el);
  }
  el.innerHTML = lines.map((l, i) => (i === 0 ? `<b>${esc(l)}</b>` : `<span>${esc(l)}</span>`)).join('');
  el.classList.add('show');
  clearTimeout(tvNotice.t);
  tvNotice.t = setTimeout(() => el.classList.remove('show'), ms);
}

// ── 프레젠터 모드: /display?presenter=1 ─────────────────────────────
//  교사 PIN 확인 후에만 키 입력이 진행 명령이 됨. 교사 콘솔의 [다음]/[이전]과 같은 서버 명령을 '안전 모드'로 호출:
//  학생이 아직 결정 중인 회의 단계에서는 넘어가지 않음 (강제 진행은 교사 콘솔에서만).
if (PRESENTER) {
  const PIN_KEY = 'slangi.presenterPin';
  const NEXT_KEYS = new Set(['PageDown', 'ArrowRight', 'Enter', ' ', 'Spacebar']);
  const PREV_KEYS = new Set(['PageUp', 'ArrowLeft', 'Backspace']);
  const LOCK_MS = 600; // 한 번 누르면 한 장면만: 이 시간 안의 추가 입력·키 반복은 무시
  let pin = '';
  let authed = false;
  let inflight = false;
  let lockUntil = 0;

  const badge = document.createElement('div');
  badge.className = 'presenter-badge hidden';
  badge.innerHTML = '<span class="pdot"></span>PRESENTER<span class="pkeys">‹ 이전 · 다음 ›</span>';
  document.body.appendChild(badge);
  const setBadge = (state) => {
    badge.classList.toggle('busy', state === 'busy');
    badge.classList.toggle('err', state === 'err');
  };

  const gate = document.createElement('div');
  gate.className = 'pin-gate hidden';
  gate.innerHTML = `
    <form class="pin-box" autocomplete="off">
      <h2>프레젠터 모드</h2>
      <p>교사 PIN을 입력하면 리모컨(→ ← PageDown PageUp)으로 화면을 넘길 수 있어요.</p>
      <input type="password" inputmode="numeric" placeholder="PIN" aria-label="교사 PIN">
      <button type="submit">시작하기 (전체화면)</button>
      <p class="pin-err"></p>
      <a href="/display">보기 전용 TV 화면으로</a>
    </form>`;
  document.body.appendChild(gate);
  const input = $('input', gate);

  async function login(p, { silent = false } = {}) {
    try {
      await api('/api/admin/login', {}, { 'x-admin-pin': p });
      pin = p;
      authed = true;
      try {
        sessionStorage.setItem(PIN_KEY, p);
      } catch { /* noop */ }
      gate.classList.add('hidden');
      badge.classList.remove('hidden');
      setBadge('ok');
      return true;
    } catch (e) {
      if (e.status === 401 || e.status === 429) {
        try {
          sessionStorage.removeItem(PIN_KEY);
        } catch { /* noop */ }
        authed = false;
      }
      if (!silent) $('.pin-err', gate).textContent = e.message;
      return false;
    }
  }
  function showGate() {
    authed = false;
    badge.classList.add('hidden');
    gate.classList.remove('hidden');
    setTimeout(() => input.focus(), 50);
  }
  $('form', gate).addEventListener('submit', async (e) => {
    e.preventDefault();
    unlockAudio();
    document.documentElement.requestFullscreen?.().catch(() => {});
    if (await login(input.value.trim())) input.value = '';
  });

  let saved = '';
  try {
    saved = sessionStorage.getItem(PIN_KEY) || '';
  } catch { /* noop */ }
  if (saved) {
    login(saved, { silent: true }).then((ok) => {
      if (!ok && !authed) showGate();
    });
  } else showGate();

  async function go(dir) {
    if (!view) return;
    setBadge('busy');
    inflight = true;
    try {
      const r = await api(
        '/api/admin/action',
        { action: dir, presenter: true, from: view.step.id, fromReveal: view.reveal?.index ?? null },
        { 'x-admin-pin': pin },
      );
      setBadge('ok');
      if (r.view) onState(r.view);
    } catch (e) {
      setBadge('err');
      setTimeout(() => setBadge('ok'), 1200);
      if (e.status === 423) tvNotice([e.message, '강제 진행은 교사 화면에서 할 수 있습니다.']);
      else if (e.status === 401) showGate();
      else if (e.status === 409) live.refresh(); // 교사 콘솔에서 이미 넘김 → 화면만 최신으로
      else tvNotice(['잠시 연결이 원활하지 않아요.', '한 번 더 눌러 주세요.'], 2500);
    } finally {
      inflight = false;
    }
  }

  document.addEventListener('keydown', (e) => {
    if (!authed || !gate.classList.contains('hidden')) return;
    const dir = NEXT_KEYS.has(e.key) ? 'next' : PREV_KEYS.has(e.key) ? 'prev' : null;
    if (!dir) return;
    e.preventDefault(); // 스크롤·뒤로가기 등 브라우저 기본 동작 막기
    e.stopPropagation();
    unlockAudio();
    if (e.repeat || inflight || Date.now() < lockUntil) return;
    lockUntil = Date.now() + LOCK_MS;
    go(dir);
  }, true);
}

if (!PRESENTER) {
  // 보기 전용 TV: 키보드로 수업 상태를 바꾸지 않음. (클릭/키 입력은 효과음 허용용으로만 사용)
  document.addEventListener('keydown', () => unlockAudio());
}

function confetti() {
  if (PREVIEW) return;
  const box = document.createElement('div');
  box.className = 'confetti';
  const colors = ['#F0508A', '#16A36A', '#7C5CF2', '#E8860C', '#2F7BF0', '#f2a900'];
  box.innerHTML = Array.from({ length: 90 }, () => {
    const left = Math.random() * 100;
    const dur = 2.6 + Math.random() * 2.4;
    const delay = 0.6 + Math.random() * 1.8;
    return `<i style="left:${left}%; background:${colors[Math.floor(Math.random() * colors.length)]}; animation-duration:${dur}s; animation-delay:${delay}s"></i>`;
  }).join('');
  stage.appendChild(box);
  setTimeout(() => box.remove(), 7000);
}

window.addEventListener('resize', () => {
  if (view && ['responses', 'reflectionResponses'].includes(view.step.kind)) fitReasons();
});
