// 교실 TV 화면 /display — 교사가 /admin 에서 진행하면 자동으로 바뀝니다.
// 이 화면에서도 키보드·PPT 프레젠터 리모컨으로 앞뒤 진행 가능 (교사 PIN 한 번 확인, 이 컴퓨터에 기억)
//   /display?presenter=1 : 예전 주소 호환 (처음부터 PIN 입력 창)
//   /display?preview=1   : 교사 콘솔 미리보기 (음소거, 조작 없음)
import { $, $$, esc, won, signedWon, medal, connectLive, netBanner, animateNumber, fitText, api, storage } from './common.js';
import { unlockAudio, setMuted, typeClick, newsSting, bell, drumroll, accent, fanfare } from './sfx.js';

const params = new URLSearchParams(location.search);
const PREVIEW = params.has('preview');
const PRESENTER_URL = params.get('presenter') === '1' && !PREVIEW;
const stage = $('#stage');
let view = null;
let lastKey = '';
let live = null;

const remPx = () => parseFloat(getComputedStyle(document.documentElement).fontSize);
setMuted(PREVIEW);

// ── 시작 안내: 한 번 클릭(또는 키 입력)하면 이후 효과음 재생이 허용됨 ─────────────
const starter = $('#starter');
const hideStarter = () => starter.classList.add('hidden');
if (!PREVIEW) {
  if (!PRESENTER_URL) starter.classList.remove('hidden');
  starter.addEventListener('click', (e) => {
    e.stopPropagation();
    hideStarter();
    unlockAudio();
    document.documentElement.requestFullscreen?.().catch(() => {});
  });
  document.addEventListener('click', () => {
    unlockAudio();
    hideStarter();
  });
  document.addEventListener('dblclick', () => toggleFullscreen());
  setupFullscreenButton();
}

function toggleFullscreen() {
  try {
    if (document.fullscreenElement) document.exitFullscreen?.()?.catch?.(() => {});
    else document.documentElement.requestFullscreen?.()?.catch?.(() => {});
  } catch { /* noop */ }
}

// ── 전체화면 버튼 (항상 오른쪽 아래) ─────────────────────────────────────
function setupFullscreenButton() {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'fs-btn';
  btn.tabIndex = -1; // 키보드 포커스를 받지 않음 → Enter/Space 가 버튼을 누르지 않고 '다음'으로만 동작
  const sync = () => {
    btn.textContent = document.fullscreenElement ? '⤢ 전체화면 종료' : '⛶ 전체화면';
  };
  btn.addEventListener('mousedown', (e) => e.preventDefault()); // 클릭해도 포커스가 가지 않게
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    unlockAudio();
    hideStarter();
    toggleFullscreen();
    btn.blur();
  });
  btn.addEventListener('dblclick', (e) => e.stopPropagation());
  document.addEventListener('fullscreenchange', sync);
  sync();
  document.body.appendChild(btn);
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
    cancelScene();
    render(v, prev);
  }
  updateLive(v);
}

// ── 장면 연출 타이머: 화면이 바뀌면 이전 장면의 예약된 연출은 모두 취소 ─────────
let sceneSeq = 0;
const cancelScene = () => {
  sceneSeq += 1;
};
const later = (ms) => new Promise((r) => setTimeout(r, ms));
// 지금 장면이 그대로일 때만 실행
function at(ms, fn) {
  const my = sceneSeq;
  setTimeout(() => {
    if (my === sceneSeq) fn();
  }, ms);
}

// 타이핑 효과 (뉴스 제목, 사회면)
function typeText(el, text, { cps = 11, sound = true } = {}) {
  const my = sceneSeq;
  const chars = [...text];
  el.textContent = '';
  el.classList.add('typing');
  return new Promise((resolve) => {
    let i = 0;
    const tick = () => {
      if (my !== sceneSeq || !el.isConnected) return resolve(false);
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

const sameStep = (v, prev) => !!prev && prev.sessionId === v.sessionId && prev.step.id === v.step.id;
const cameBack = (v, prev) => !!prev && prev.sessionId === v.sessionId && prev.step.index > v.step.index;
const scoreText = (n) => {
  const r = Math.round(n);
  return r < 0 ? `−${Math.abs(r)}` : String(r);
};

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

  // 최종 이윤 순위: 시상식처럼 빈 무대 → 두구두구 → 3위 → 2위 → 두구두구 → 1위(가장 강하게) → 4·5위
  final(v, prev) {
    const st = v.standings;
    const [a, b, c, ...rest] = st;
    const pod = (x, cls) => x ? `<div class="pod ${cls}" style="--c:${x.color}">
      <div class="md">${medal(x.rank) || `${x.rank}위`}</div><div class="nm">${esc(x.name)}</div>
      <div class="pf num">${signedWon(x.profit)}</div>${cls === 'p1' ? '<div class="cheer">축하합니다! 🎉</div>' : ''}</div>` : '<div></div>';
    // 같은 화면을 다시 그리는 경우(연결 갱신 등)에는 연출 없이 바로 전체 표시
    const instant = sameStep(v, prev) || cameBack(v, prev);
    stage.innerHTML = `${topbar(v, '최종 결과')}
      <div class="final-wrap ${instant ? 'instant' : ''}">
        <div class="final-head"><div class="sub">돌멩민국 슬랑이 시장</div><h1>최종 기업 이윤 순위</h1></div>
        <div class="podium">${pod(b, 'p2')}${pod(a, 'p1')}${pod(c, 'p3')}</div>
        <div class="rest">${rest.map((x, i) => `<div class="rr" style="--c:${x.color}; animation-delay:${i * 0.15}s"><span>${x.rank}위</span><span>${esc(x.name)}</span><span class="num">${signedWon(x.profit)}</span></div>`).join('')}</div>
      </div>`;
    const show = (sel) => $(sel, stage)?.classList.add('in');
    if (instant) {
      ['.pod.p3', '.pod.p2', '.pod.p1', '.rest'].forEach(show);
      return;
    }
    at(900, () => drumroll(1.1));
    at(2100, () => { show('.pod.p3'); accent(); });
    at(2750, () => { show('.pod.p2'); accent(); });
    at(3050, () => drumroll(0.75));
    at(3900, () => { show('.pod.p1'); fanfare(); confetti(); });
    at(4700, () => show('.rest'));
  },

  blackout() {
    stage.innerHTML = `<div class="center">
      <p class="blackout-1">하지만…</p>
      <p class="blackout-2">기업의 선택은<br>기업 안에서만 끝나지 않았습니다.</p></div>`;
  },

  // 뉴스: 속보 시그널 → 제목 타이핑 → 잠시 뒤 기사 내용·관련 기업 자동 등장 → 그대로 정지
  //   (다음 기사로는 교사가 → 를 눌러야 이동)
  news(v, prev) {
    const n = v.news;
    if (!n) {
      stage.innerHTML = '<div class="center"></div>';
      return;
    }
    if (sameStep(v, prev) && $('.news', stage)) {
      // 같은 뉴스 화면: 티커·제목 DOM 을 다시 만들지 않음 (티커 애니메이션이 처음부터 다시 시작되지 않게)
      const h1 = $('.news h1', stage);
      if (h1.textContent !== n.headline) {
        h1.classList.remove('typing');
        h1.textContent = n.headline;
      }
      $('#news-detail').classList.add('show');
      return;
    }
    const back = cameBack(v, prev); // 뒤로 돌아온 경우: 연출 없이 바로 전체
    const tickerText = `돌멩민국 경제뉴스 · ${esc(n.headline)}${n.lines[0] ? ` · ${esc(n.lines[0])}` : ''}`;
    stage.innerHTML = `${topbar(v, '돌멩민국 경제뉴스')}
      <div class="news">
        <div class="tagline"><span class="live">속보</span><span>[${esc(n.tag)}]</span><span class="cat">${esc(n.category)}</span></div>
        <h1 class="typed">${back ? esc(n.headline) : ''}</h1>
        <div id="news-detail" class="${back ? 'show instant' : ''}">
          <div class="lines">${n.lines.map((l, i) => `<p style="animation-delay:${i * 0.6}s">${esc(l)}</p>`).join('')}</div>
          <div class="chips" style="animation-delay:${0.3 + n.lines.length * 0.6}s">${n.companies.map((c) => `<span class="chip"><span class="cdot" style="--c:${c.color}"></span>${esc(c.name)} <small>${esc(c.note)}</small></span>`).join('')}</div>
        </div>
      </div>
      <div class="ticker"><div class="ticker-track">${tickerText}</div></div>`;
    if (back) return;
    const my = sceneSeq;
    newsSting();
    later(700)
      .then(() => (my === sceneSeq ? typeText($('.news h1', stage), n.headline) : false))
      .then((typed) => {
        if (typed) at(1000, () => $('#news-detail')?.classList.add('show'));
      });
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
    const my = sceneSeq;
    newsSting();
    await later(800);
    for (const h of $$('.paper h2[data-head]', stage)) {
      if (my !== sceneSeq) return;
      h.closest('.article').classList.add('in');
      await typeText(h, h.dataset.head, { cps: 13 });
      await later(500);
    }
  },

  // 사회점수: 100 → (클릭) 소비자 보호 합계 → 환경 합계 → 공정 경쟁 합계 → 최종 점수 중앙 이동 + 발문
  score(v, prev) {
    const sc = v.score;
    const stepFwd = sameStep(v, prev) && prev.score && prev.score.revealIndex === sc.revealIndex - 1;
    if (sc.done && stepFwd && $('.score', stage) && !$('.score.is-final', stage)) {
      scoreToFinal(sc);
      return;
    }
    const newest = !sc.done && stepFwd && sc.categories.length ? sc.categories[sc.categories.length - 1] : null;
    renderScore(v, sc, newest);
  },

  reflection(v) {
    stage.innerHTML = `${topbar(v, '정리')}
      <div class="center">
        <div class="round-label">우리 기업의 선택 다시 생각하기</div>
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

// ── 사회점수 화면 ─────────────────────────────────────────────────────
function scoreCard(c, isNew) {
  return `<div class="scat ${c.category} ${isNew ? 'new' : ''}">
    <div class="scat-head"><span class="ct">${esc(c.label)}</span><span class="dl num">${scoreText(c.delta)}</span></div>
    ${c.groups.map((g) => `<div class="sg">
      <div class="sg-top"><b>${esc(g.label)}</b>${c.groups.length > 1 ? `<span class="sgd num">${scoreText(g.delta)}</span>` : ''}</div>
      <small>${g.companies.map((x) => `<span class="cdot" style="--c:${x.color}"></span>${esc(x.name)}`).join('<em>·</em>')}</small>
    </div>`).join('')}
  </div>`;
}

function renderScore(v, sc, newest) {
  const cats = sc.categories;
  const cur = sc.done ? sc.final : cats.length ? cats[cats.length - 1].after : sc.start;
  const noLoss = sc.done && sc.final >= sc.start;
  stage.innerHTML = `${topbar(v, '사회적 영향')}
    <div class="score ${sc.done ? 'is-final' : ''} ${noLoss ? 'no-loss' : ''}">
      <div class="score-left">
        <div class="lbl">돌멩민국 사회점수</div>
        <div class="score-num num ${cur < 0 ? 'neg' : ''} ${sc.done && !noLoss ? 'red' : ''}" id="snum">${scoreText(newest ? newest.before : cur)}</div>
      </div>
      <div class="score-cats">
        ${cats.length ? cats.map((c, i) => scoreCard(c, newest && i === cats.length - 1)).join('') : '<div class="score-empty">아직 감점 없음.</div>'}
      </div>
      ${scoreQuestions(sc)}
    </div>`;
  if (sc.done) {
    at(300, () => $('.score-q', stage)?.classList.add('show'));
    return;
  }
  if (newest) {
    const el = $('#snum');
    at(700, () => {
      el.classList.add('hit');
      animateNumber(el, newest.before, newest.after, {
        duration: 1400,
        format: (n) => {
          el.classList.toggle('neg', Math.round(n) < 0);
          return scoreText(n);
        },
      });
    });
  }
}

function scoreQuestions(sc) {
  if (!sc.done) return '<div class="score-q"></div>';
  if (sc.final >= sc.start) return '<div class="score-q"><p class="q-main">기업들의 선택으로 줄어든 사회점수가 없습니다.</p></div>';
  return `<div class="score-q"><p class="q-main">${esc(sc.questions.main)}</p><p class="q-sub">${esc(sc.questions.sub)}</p></div>`;
}

// 최종 장면: 왼쪽에 있던 점수가 그대로 화면 가운데로 이동하며 커지고 빨간색으로 (FLIP) → 0.8초 뒤 발문
function scoreToFinal(sc) {
  const root = $('.score', stage);
  const num = $('#snum');
  const lbl = $('.score-left .lbl', stage);
  cancelAnimationFrame(num._raf);
  num.classList.remove('hit');
  num.textContent = scoreText(sc.final);
  root.querySelector('.score-q').outerHTML = scoreQuestions(sc);
  const els = [lbl, num];
  const first = els.map((el) => el.getBoundingClientRect());
  root.classList.add('is-final');
  if (sc.final >= sc.start) root.classList.add('no-loss');
  const last = els.map((el) => el.getBoundingClientRect());
  els.forEach((el, i) => {
    const f = first[i];
    const l = last[i];
    const dx = f.left + f.width / 2 - (l.left + l.width / 2);
    const dy = f.top + f.height / 2 - (l.top + l.height / 2);
    const s = l.height ? f.height / l.height : 1;
    el.style.transition = 'none';
    el.style.transform = `translate(${dx}px, ${dy}px) scale(${s})`;
  });
  void root.offsetWidth; // 시작 위치를 먼저 그린 뒤
  requestAnimationFrame(() => {
    els.forEach((el) => {
      el.style.transition = 'transform 1.3s cubic-bezier(.22,.8,.24,1), color 1s ease, text-shadow 1s ease';
      el.style.transform = '';
    });
    if (sc.final < sc.start) num.classList.add('red');
  });
  at(1300 + 800, () => $('.score-q', stage)?.classList.add('show'));
}

function renderResponsesTable(v, title, sub) {
  const pred = !!v.roundInfo.prediction;
  stage.innerHTML = `${topbar(v, roundPill(v))}
    <div class="table-title">${esc(title)} <small>${sub}</small></div>
    <div class="resp ${pred ? 'with-pred' : ''}">
      ${v.responses.map((r, i) => `
        <div class="resp-row ${r.choiceLabel ? '' : 'missing'}" style="--c:${r.color}; animation-delay:${i * 0.1}s">
          <div class="who">${esc(r.name)}</div>
          <div class="what ${r.choice === 'join' ? 'join' : ''}">${r.choiceLabel ? esc(r.choiceLabel) : '미제출'}</div>
          <div class="why"><span>${r.choiceLabel && !r.byDefault ? `${esc(r.reason)} <b>때문입니다.</b>` : ''}</span></div>
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

// TV 하단에 잠깐 뜨는 안내 (키보드로 넘길 수 없을 때 등)
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

// ── 키보드·리모컨 진행 ─────────────────────────────────────────────────
//  교사 콘솔의 [다음]/[이전]과 같은 서버 명령을 '안전 모드'로 호출 (클라이언트는 상태를 직접 바꾸지 않음):
//  학생이 아직 결정 중인 회의·정리 단계에서는 넘어가지 않음 (강제 진행은 교사 콘솔에서만).
//  교사 PIN 은 교사 콘솔과 같은 저장값을 사용 → 이 컴퓨터에서 교사 콘솔에 로그인했다면 다시 묻지 않음.
if (!PREVIEW) setupKeyboardControl();

function setupKeyboardControl() {
  const PIN_KEY = 'slangi.adminPin';
  const NEXT_KEYS = new Set(['PageDown', 'ArrowRight', 'Enter', ' ', 'Spacebar']);
  const PREV_KEYS = new Set(['PageUp', 'ArrowLeft', 'Backspace']);
  const LOCK_MS = 600; // 한 번 누르면 한 장면만: 이 시간 안의 추가 입력·키 반복은 무시
  let pin = storage.get(PIN_KEY) || '';
  let authed = false;
  let checking = null; // 저장된 PIN 확인 중
  let inflight = false;
  let lockUntil = 0;

  const badge = document.createElement('div');
  badge.className = 'presenter-badge hidden';
  badge.innerHTML = '<span class="pdot"></span>리모컨 진행<span class="pkeys">‹ 이전 · 다음 ›</span>';
  document.body.appendChild(badge);
  const setBadge = (state) => {
    badge.classList.toggle('busy', state === 'busy');
    badge.classList.toggle('err', state === 'err');
  };

  const gate = document.createElement('div');
  gate.className = 'pin-gate hidden';
  gate.innerHTML = `
    <form class="pin-box" autocomplete="off">
      <h2>키보드·리모컨으로 진행</h2>
      <p>교사 PIN을 한 번 입력하면 이 TV 화면에서 → ← PageDown PageUp 으로 넘길 수 있어요. (이 컴퓨터에 기억됩니다)</p>
      <input type="password" inputmode="numeric" placeholder="PIN" aria-label="교사 PIN">
      <button type="submit">시작하기 (전체화면)</button>
      <p class="pin-err"></p>
      <button type="button" class="pin-cancel">닫기 (보기만 하기)</button>
    </form>`;
  document.body.appendChild(gate);
  const input = $('input', gate);
  const gateOpen = () => !gate.classList.contains('hidden');

  async function login(p, { silent = false } = {}) {
    try {
      await api('/api/admin/login', {}, { 'x-admin-pin': p });
      pin = p;
      authed = true;
      storage.set(PIN_KEY, p);
      gate.classList.add('hidden');
      badge.classList.remove('hidden');
      setBadge('ok');
      return true;
    } catch (e) {
      if (e.status === 401 || e.status === 429) {
        if (p === storage.get(PIN_KEY)) storage.del(PIN_KEY);
        authed = false;
      }
      if (!silent) $('.pin-err', gate).textContent = e.message;
      return false;
    }
  }
  function showGate() {
    authed = false;
    badge.classList.add('hidden');
    $('.pin-err', gate).textContent = '';
    gate.classList.remove('hidden');
    setTimeout(() => input.focus(), 50);
  }
  const hideGate = () => {
    gate.classList.add('hidden');
    input.blur();
  };
  $('form', gate).addEventListener('submit', async (e) => {
    e.preventDefault();
    unlockAudio();
    hideStarter();
    document.documentElement.requestFullscreen?.().catch(() => {});
    if (await login(input.value.trim())) input.value = '';
  });
  $('.pin-cancel', gate).addEventListener('click', (e) => {
    e.stopPropagation();
    hideGate();
  });
  gate.addEventListener('click', (e) => e.stopPropagation());

  if (pin) {
    checking = login(pin, { silent: true }).then((ok) => {
      checking = null;
      if (!ok && PRESENTER_URL) showGate();
      return ok;
    });
  } else if (PRESENTER_URL) showGate();

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
      else if (e.status === 409) {
        live.refresh(); // 교사 콘솔에서 이미 넘김 → 화면만 최신으로
        if (!/이미/.test(e.message)) tvNotice([e.message, '교사 화면에서 확인해 주세요.']);
      } else tvNotice(['잠시 연결이 원활하지 않아요.', '한 번 더 눌러 주세요.'], 2500);
    } finally {
      inflight = false;
    }
  }

  document.addEventListener('keydown', async (e) => {
    if (gateOpen()) {
      if (e.key === 'Escape') hideGate();
      return; // PIN 입력 중에는 키가 입력창으로
    }
    const dir = NEXT_KEYS.has(e.key) ? 'next' : PREV_KEYS.has(e.key) ? 'prev' : null;
    unlockAudio();
    hideStarter();
    if (!dir) return;
    e.preventDefault(); // 스크롤·뒤로가기 등 브라우저 기본 동작 막기
    e.stopPropagation();
    if (e.repeat || inflight || Date.now() < lockUntil) return;
    lockUntil = Date.now() + LOCK_MS;
    if (!authed && checking) await checking;
    if (!authed) return showGate();
    go(dir);
  }, true);
}

function confetti() {
  if (PREVIEW) return;
  const box = document.createElement('div');
  box.className = 'confetti';
  const colors = ['#F0508A', '#16A36A', '#7C5CF2', '#E8860C', '#2F7BF0', '#f2a900'];
  box.innerHTML = Array.from({ length: 110 }, () => {
    const left = Math.random() * 100;
    const dur = 2.6 + Math.random() * 2.4;
    const delay = Math.random() * 1.2;
    return `<i style="left:${left}%; background:${colors[Math.floor(Math.random() * colors.length)]}; animation-duration:${dur}s; animation-delay:${delay}s"></i>`;
  }).join('');
  stage.appendChild(box);
  setTimeout(() => box.remove(), 7000);
}

window.addEventListener('resize', () => {
  if (view && ['responses', 'reflectionResponses'].includes(view.step.kind)) fitReasons();
});
