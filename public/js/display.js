// 교실 TV 화면 /display — 교사가 /admin 에서 진행하면 자동으로 바뀝니다. (조작 버튼 없음)
import { $, $$, esc, won, signedWon, signed, medal, connectStream, netBanner, animateNumber, fitText } from './common.js';

const PREVIEW = new URLSearchParams(location.search).has('preview'); // 어드민 미리보기용 (음소거)
const stage = $('#stage');
let view = null;
let lastKey = '';
let lastVideoNonce = null;

const remPx = () => parseFloat(getComputedStyle(document.documentElement).fontSize);

// ── 시작 버튼: 한 번 클릭하면 이후 영상 소리 재생이 허용됨 ─────────────
const starter = $('#starter');
if (!PREVIEW) {
  starter.classList.remove('hidden');
  starter.addEventListener('click', (e) => {
    e.stopPropagation();
    starter.classList.add('hidden');
    document.documentElement.requestFullscreen?.().catch(() => {});
  });
  document.addEventListener('click', () => starter.classList.add('hidden'));
  document.addEventListener('dblclick', () => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.().catch(() => {});
  });
}

connectStream({ role: 'display' }, { onState, onStatus: PREVIEW ? () => {} : netBanner });

function onState(v) {
  if (view && v.sessionId === view.sessionId && v.rev < view.rev) return;
  if (lastVideoNonce === null || (view && v.sessionId !== view.sessionId)) lastVideoNonce = v.video?.nonce ?? 0;
  const prev = view;
  view = v;
  const k = v.step.kind;
  // 화면을 다시 그릴지 결정하는 키 (접속·제출 수 같은 작은 변화는 다시 그리지 않고 갱신만)
  const key = JSON.stringify({
    ...v, rev: 0, serverTime: 0,
    submittedCount: ['meeting', 'reflection'].includes(k) ? 0 : v.submittedCount,
    submittedTeams: 0,
    companies: 0,
    video: v.video ? v.video.available : 0,
  });
  if (key !== lastKey) {
    lastKey = key;
    render(v, prev);
  }
  updateLive(v);
  handleVideo(v);
}

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

  news(v) {
    const n = v.news;
    if (!n) {
      stage.innerHTML = '<div class="center"></div>';
      return;
    }
    stage.innerHTML = `${topbar(v, '돌멩민국 경제뉴스')}
      <div class="news">
        <div class="tagline"><span class="live">속보</span><span>[${esc(n.tag)}]</span><span class="cat">${esc(n.category)}</span></div>
        <h1>${esc(n.headline)}</h1>
        <div class="lines">${n.lines.map((l) => `<p>${esc(l)}</p>`).join('')}</div>
        <div class="chips">${n.companies.map((c) => `<span class="chip"><span class="cdot" style="--c:${c.color}"></span>${esc(c.name)} <small>${esc(c.note)}</small></span>`).join('')}</div>
      </div>
      <div class="ticker"><span>돌멩민국 경제뉴스 · ${esc(n.headline)} · ${esc(n.lines[0])}</span></div>`;
  },

  video(v) {
    if (v.video?.available) {
      stage.innerHTML = `<div class="video-wrap"><video id="vid" src="${esc(v.video.url)}" preload="auto" playsinline ${PREVIEW ? 'muted' : ''}></video></div>`;
      $('#vid').addEventListener('error', () => {
        view.video.available = false;
        RENDER.video(view);
      });
      return;
    }
    const heads = v.headlines ?? [];
    stage.innerHTML = `${topbar(v, '돌멩민국 경제뉴스')}
      <div class="center fallback">
        <div class="fb-tag"><span class="live">LIVE</span>돌멩민국 경제뉴스</div>
        <h1>오늘의 주요 소식</h1>
        <ul>${heads.length ? heads.map((h, i) => `<li style="animation-delay:${0.5 + i * 0.6}s"><small>${esc(h.category)}</small>${esc(h.headline)}</li>`).join('') : '<li>오늘 돌멩민국 슬랑이 시장에는 큰 사건이 없었습니다.</li>'}</ul>
      </div>`;
  },

  score(v, prev) {
    const sc = v.score;
    const items = sc.items;
    const cur = items.length ? items[items.length - 1].after : sc.start;
    const isStep = prev && prev.step.id === v.step.id && prev.score && prev.score.revealIndex === sc.revealIndex - 1;
    const newest = isStep && items.length ? items[items.length - 1] : null;
    stage.innerHTML = `${topbar(v, '사회적 영향')}
      <div class="score">
        <div class="score-left">
          <div class="lbl">돌멩민국 사회점수</div>
          <div class="score-num num ${cur < 0 ? 'neg' : ''}" id="snum">${signed(newest ? newest.before : cur).replace('+', '')}</div>
          <div class="final ${sc.done && sc.total ? 'show' : ''}">최종 사회점수</div>
        </div>
        <div class="score-items ${sc.total > 8 ? 'dense' : sc.total > 5 ? 'compact' : ''}">
          ${sc.total === 0 ? '<div class="score-none">기업들의 선택으로 줄어든 사회점수가 없습니다.</div>' : ''}
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

function handleVideo(v) {
  if (!v.video) return;
  const el = $('#vid');
  if (v.video.nonce === lastVideoNonce) return;
  lastVideoNonce = v.video.nonce;
  if (!el) return;
  if (v.video.command === 'play') {
    el.currentTime = 0;
    el.muted = PREVIEW;
    el.play().catch(() => {
      el.muted = true;
      el.play().catch(() => {});
      showHint('브라우저가 소리를 막아 음소거로 재생 중입니다. TV 화면을 한 번 클릭하면 다음부터 소리가 나옵니다.');
    });
  } else if (v.video.command === 'stop') {
    el.pause();
  }
}

function showHint(msg) {
  if (PREVIEW) return;
  const h = document.createElement('div');
  h.className = 'hint';
  h.textContent = msg;
  document.body.appendChild(h);
  setTimeout(() => h.remove(), 6000);
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
