// 학생(모둠) 화면 — 사이트 기본 주소 / (그리고 /play)
import {
  $, $$, esc, won, signedWon, medal, connectLive, connBadge, api, toast, animateNumber, storage, withJosa, josa,
} from './common.js';

// 같은 브라우저에서 여러 탭으로 테스트할 때: /play?t=2 처럼 구분
const slot = new URLSearchParams(location.search).get('t') || '';
const TOKEN_KEY = `slangi.token${slot}`; // 재접속 토큰 (기업 선택 시 저장, 진짜 무효일 때만 삭제)
const NAME_KEY = `slangi.teamName${slot}`; // '○○기업으로 다시 연결하고 있습니다…' 표시용
let token = storage.get(TOKEN_KEY) || '';
let view = null;
let live = null;
let screenKey = '';
let busy = false;
let hudPrev = null;
let form = {}; // 현재 입력 중인 선택/이유 (새로고침해도 복구되도록 localStorage에 저장)
let formKey = '';
let reconnecting = !!token; // 저장된 토큰으로 다시 들어온 경우

const main = $('#main');
const hud = $('#hud');

// 이 탭(노트북)을 구분하는 값 — 교사 화면의 '2대 접속' 경고용
const clientId = (() => {
  try {
    let id = sessionStorage.getItem('slangi.client');
    if (!id) {
      id = Math.random().toString(36).slice(2) + Date.now().toString(36);
      sessionStorage.setItem('slangi.client', id);
    }
    return id;
  } catch {
    return Math.random().toString(36).slice(2);
  }
})();

if (reconnecting) {
  const name = storage.get(NAME_KEY);
  main.innerHTML = `<p class="loading">${name ? `${esc(withJosa(name, '으로'))} 다시 연결하고 있습니다…` : '다시 연결하고 있습니다…'}</p>`;
}

function startLive() {
  live = connectLive(
    { role: 'play', headers: () => ({ 'x-team-token': token, 'x-client-id': clientId }) },
    { onState, onStatus: connBadge },
  );
}

function onState(v) {
  if (view && v.sessionId === view.sessionId && v.rev < view.rev) return; // 오래된 상태 무시
  // 서버가 저장된 게임을 읽고 '이 토큰은 없다'고 확인한 경우에만 (교사가 연결 해제 / 전체 초기화)
  // 인터넷이 끊긴 경우는 여기까지 오지 않으므로 토큰이 지워지지 않음
  if (v.tokenRejected && token) {
    token = '';
    reconnecting = false;
    storage.del(TOKEN_KEY);
    storage.del(NAME_KEY);
    toast('기업 연결이 초기화되었어요. 기업을 다시 선택해 주세요.', { ms: 4500 });
    screenKey = '';
    live.refresh();
    return;
  }
  if (v.me) {
    storage.set(NAME_KEY, v.me.name);
    if (reconnecting) {
      reconnecting = false;
      connBadge('recovered');
    }
  }
  view = v;
  render();
}

// ── 입력 임시 저장 ─────────────────────────────────────
function loadForm(key) {
  if (formKey === key) return;
  formKey = key;
  try {
    form = JSON.parse(storage.get(`draft:${key}`) || '{}') || {};
  } catch {
    form = {};
  }
}
function saveForm() {
  storage.set(`draft:${formKey}`, JSON.stringify(form));
}
function clearForm() {
  storage.del(`draft:${formKey}`);
  form = {};
}

// ── 렌더 ─────────────────────────────────────────────
function render() {
  const v = view;
  document.body.style.setProperty('--team', v.me?.color ?? '#ff5a2e');
  document.body.classList.toggle('dim', !!v.step.dark && !!v.me);
  renderHud(v);
  const key = [
    v.sessionId, v.me?.id ?? '-', v.step.id, v.canSubmit, !!v.mySubmission, v.roundComputed, !!v.myResult,
    v.reflection?.canReflect, !!v.reflection?.mine, v.canSubmit ? v.me.cash : '', v.me ? '' : JSON.stringify(v.companies),
  ].join('|');
  if (key === screenKey) {
    $$('[data-live="submitted"]').forEach((el) => { el.textContent = v.submittedCount; });
    return;
  }
  screenKey = key;
  if (!v.me) return renderSelect(v);
  const k = v.step.kind;
  if (k === 'intro') return renderIntro(v);
  if (v.step.round && ['scene', 'meeting', 'responses'].includes(k)) {
    if (k === 'meeting' && v.canSubmit) return renderRoundForm(v);
    if (k === 'scene' || (k === 'meeting' && v.roundComputed && !v.mySubmission)) return renderScene(v);
    return renderSubmitted(v);
  }
  if ((k === 'result' || k === 'rank') && v.myResult) return renderResult(v);
  if (k === 'final') return renderFinal(v);
  if (v.step.dark && k !== 'closing') return renderTv();
  if (k === 'reflection' && v.reflection?.canReflect) return renderReflectionForm(v);
  if (['reflection', 'reflectionResponses', 'closing'].includes(k)) return renderReflectionDone(v);
  return renderTv();
}

function renderHud(v) {
  if (!v.me) {
    hud.classList.add('hidden');
    hudPrev = null;
    return;
  }
  hud.classList.remove('hidden');
  const m = v.me;
  const profitCls = m.profit > 0 ? 'pos' : m.profit < 0 ? 'neg' : '';
  const rank = m.rank ? `${medal(m.rank)} ${m.rank}위` : '';
  if (!$('.hud-inner', hud) || hud.dataset.team !== String(m.id)) {
    hud.dataset.team = m.id;
    hud.innerHTML = `
      <div class="hud-inner">
        <div class="brand"><span class="dot" style="--c:${m.color}"></span>${esc(m.name)}</div>
        <div class="stat"><span class="k">현재 가진 돈</span><span class="v num" id="h-cash"></span></div>
        <div class="stat"><span class="k">지금까지 슬랑이를 판 돈</span><span class="v num" id="h-rev"></span></div>
        <div class="stat profit"><span class="k">이윤 <em id="h-rank"></em></span><span class="v num" id="h-profit"></span></div>
      </div>`;
    hudPrev = null;
  }
  const set = (id, val, text, cls) => {
    const el = $(id);
    if (cls !== undefined) el.className = `v num ${cls}`;
    if (hudPrev && hudPrev[id] !== val) {
      animateNumber(el, hudPrev[id], val, { duration: 900, format: text });
      el.classList.remove('flash');
      void el.offsetWidth;
      el.classList.add('flash');
    } else el.textContent = text(val);
  };
  set('#h-cash', m.cash, won);
  set('#h-rev', m.revenueTotal, won);
  set('#h-profit', m.profit, signedWon, profitCls);
  $('#h-rank').textContent = rank;
  hudPrev = { '#h-cash': m.cash, '#h-rev': m.revenueTotal, '#h-profit': m.profit };
}

function renderSelect(v) {
  main.innerHTML = `
    <section class="center-wrap fade-up">
      <p class="eyebrow">돌멩민국 슬랑이 시장</p>
      <h1>우리 모둠의 기업을 골라 주세요</h1>
      <p class="lead">한 모둠은 하나의 기업만 선택할 수 있어요.</p>
      <div class="company-grid">
        ${v.companies.map((c) => `
          <button class="company-btn" data-team="${c.id}" style="--c:${c.color}" ${c.claimed ? 'disabled' : ''}>
            <span class="blob"></span>${esc(c.name)}<small>${c.claimed ? '이미 선택됨' : ''}</small>
          </button>`).join('')}
      </div>
    </section>`;
  $$('.company-btn', main).forEach((b) => b.addEventListener('click', () => claim(Number(b.dataset.team))));
}

async function claim(teamId) {
  const c = view.companies.find((x) => x.id === teamId);
  if (busy || !confirm(`우리 모둠은 '${c.name}'입니다.\n이 기업으로 시작할까요?`)) return;
  busy = true;
  try {
    const r = await api('/api/play/claim', { teamId });
    token = r.token;
    storage.set(TOKEN_KEY, token);
    storage.set(NAME_KEY, c.name);
    screenKey = '';
    if (r.view) onState(r.view);
    live.refresh();
  } catch (e) {
    toast(e.message, { error: true, ms: 4500 });
  } finally {
    busy = false;
  }
}

function renderIntro(v) {
  main.innerHTML = `
    <section class="center-wrap fade-up">
      <p class="eyebrow">돌멩민국 슬랑이 시장</p>
      <h1>${esc(v.me.name)} 대표님, 환영합니다!</h1>
      <p class="lead">우리 기업의 목표는 <b>이윤을 높이는 것</b>입니다.<br>선생님이 시작하면 첫 번째 결정을 내리게 됩니다.</p>
      <p class="wait">시작 자금 <b>${won(v.me.cash)}</b></p>
      <button class="small-link" id="leave">우리 기업이 아니에요 (다시 고르기)</button>
    </section>`;
  $('#leave').addEventListener('click', async () => {
    if (!confirm('기업 선택을 취소하고 다시 고를까요?')) return;
    try {
      await api('/api/play/leave', { token });
      token = '';
      storage.del(TOKEN_KEY);
      storage.del(NAME_KEY);
      screenKey = '';
      live.refresh();
    } catch (e) {
      toast(e.message, { error: true });
    }
  });
}

function costText(o) {
  return o.cost ? `<span class="opt-cost num">비용 ${won(o.cost)}</span>` : '';
}

function roundHead(ri) {
  if (ri.special) {
    return `
      <div class="special-card fade-up">
        <div class="seal">🔒 ROUND 4 · 비공개 제안</div>
        <h1>${esc(ri.title)}</h1>
        <div class="situation">${ri.situation.map((l) => `<p>${esc(l)}</p>`).join('')}</div>
        <p class="ask">${esc(ri.question)}</p>
      </div>`;
  }
  return `
    <div class="round-head fade-up"><span class="round-tag">ROUND ${ri.round}</span><h1>${esc(ri.title)}</h1><p class="q">${esc(ri.question)}</p></div>
    <div class="situation">${ri.situation.map((l) => `<p>${esc(l)}</p>`).join('')}</div>`;
}

function renderScene(v) {
  const ri = v.roundInfo;
  const locked = v.roundComputed && v.step.kind === 'meeting';
  main.innerHTML = `
    ${roundHead(ri)}
    <div class="options preview ${ri.special ? 'collusion' : ''}" style="--cols:${ri.options.length}">
      ${ri.options.map((o) => `<div class="opt"><b class="opt-label">${esc(o.label)}</b>${costText(o)}<p>${esc(o.desc)}</p></div>`).join('')}
    </div>
    <p class="wait">${locked ? '이미 결과가 나온 라운드입니다.' : '모둠 친구들과 먼저 생각해 보세요. <b>선생님이 회의 시작을 알리면</b> 선택할 수 있어요.'}</p>`;
}

// ── 라운드 선택 + 이유 ─────────────────────────────────
function renderRoundForm(v) {
  const ri = v.roundInfo;
  loadForm(`${v.sessionId}:${v.me.id}:r${ri.round}`);
  const affordable = (o) => (o.cost || 0) <= v.me.cash;
  if (form.choice != null && !ri.options.some((o) => String(o.value) === String(form.choice) && affordable(o))) form.choice = null;

  main.innerHTML = `
    ${roundHead(ri)}
    <div class="options ${ri.special ? 'collusion' : ''}" style="--cols:${ri.options.length}" id="opts">
      ${ri.options.map((o) => {
        const ok = affordable(o);
        return `<button class="opt" data-value="${esc(o.value)}" aria-pressed="false" ${ok ? '' : 'disabled'}>
          <b class="opt-label">${esc(o.label)}</b>${costText(o)}<p>${esc(o.desc)}</p>
          ${ok ? '' : '<span class="opt-warn">현재 가진 돈이 부족하여 선택할 수 없습니다.</span>'}
        </button>`;
      }).join('')}
    </div>
    <div class="panel">
      <p class="sentence" id="sentence"></p>
      <p class="sentence">그 이유는</p>
      <div class="reason-line">
        <textarea id="reason" maxlength="${v.limits.max}" rows="2" placeholder="모둠에서 이야기한 이유를 직접 써 주세요"></textarea>
        <span class="because">때문입니다.</span>
      </div>
      <p class="count"><span id="cnt">0</span> / ${v.limits.max}</p>
      <div class="hints"><b>생각 도움</b>${ri.hints.map((h) => `<span>· ${esc(h)}</span>`).join('')}</div>
    </div>
    ${ri.prediction ? `
      <div class="panel">
        <p class="sentence">${esc(ri.prediction.question)}</p>
        <div class="chips" id="pred">
          ${ri.prediction.options.map((o) => `<button class="chip-btn" data-value="${o.value}" aria-pressed="false">${esc(o.label)}</button>`).join('')}
        </div>
      </div>` : ''}
    <div class="submit-row">
      <span class="why" id="why"></span>
      <button class="btn accent big" id="submit">제출하기</button>
    </div>`;

  const reason = $('#reason');
  reason.value = form.reason || '';
  const update = () => {
    $$('#opts .opt').forEach((b) => b.setAttribute('aria-pressed', String(String(b.dataset.value) === String(form.choice))));
    $$('#pred .chip-btn').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.value === form.prediction)));
    const opt = ri.options.find((o) => String(o.value) === String(form.choice));
    $('#sentence').innerHTML = opt
      ? `${esc(opt.sentence.pre)}<strong>${esc(opt.sentence.strong)}</strong>${esc(opt.sentence.post)}`
      : '우리 기업은 <strong class="empty">위에서 선택지를 골라 주세요</strong>';
    const len = reason.value.trim().length;
    $('#cnt').textContent = reason.value.length;
    let why = '';
    if (!opt) why = '선택지를 골라 주세요';
    else if (len < v.limits.min) why = '이유를 써 주세요';
    else if (ri.prediction && !form.prediction) why = '다른 기업들의 결정을 예상해 주세요';
    $('#why').textContent = why;
    $('#submit').disabled = !!why || busy;
  };
  $$('#opts .opt').forEach((b) => b.addEventListener('click', () => {
    form.choice = b.dataset.value;
    saveForm();
    update();
  }));
  $$('#pred .chip-btn').forEach((b) => b.addEventListener('click', () => {
    form.prediction = b.dataset.value;
    saveForm();
    update();
  }));
  reason.addEventListener('input', () => {
    form.reason = reason.value;
    saveForm();
    update();
  });
  $('#submit').addEventListener('click', async () => {
    const opt = ri.options.find((o) => String(o.value) === String(form.choice));
    if (!opt || busy) return;
    const costMsg = opt.cost ? `\n비용 ${won(opt.cost)}이 현재 가진 돈에서 나갑니다.` : '';
    if (!confirm(`'${withJosa(opt.label, '으로')}' 제출할까요?${costMsg}\n제출한 뒤에는 바꿀 수 없어요.`)) return;
    busy = true;
    $('#submit').disabled = true;
    $('#submit').textContent = '제출 중…';
    try {
      const r = await api('/api/play/submit', { token, round: ri.round, choice: form.choice, reason: reason.value, prediction: form.prediction });
      clearForm();
      if (r.already) toast('이미 제출되었어요.');
      busy = false;
      if (r.view) onState(r.view);
    } catch (e) {
      busy = false;
      toast(e.message, { error: true, ms: 4000 });
      const btn = $('#submit');
      if (btn) {
        btn.textContent = '제출하기';
        update();
      }
    }
  });
  update();
}

function sentenceHtml(sub) {
  if (!sub?.sentence) return `우리 기업은 <strong>${esc(sub?.choiceLabel ?? '-')}</strong>`;
  return `${esc(sub.sentence.pre)}<strong>${esc(sub.sentence.strong)}</strong>${esc(sub.sentence.post)}`;
}

function renderSubmitted(v) {
  const sub = v.mySubmission;
  const k = v.step.kind;
  const spentLabel = v.roundInfo.round === 2 ? '광고비' : '생산비';
  main.innerHTML = `
    <section class="center-wrap">
      <p class="eyebrow">ROUND ${v.roundInfo.round} · ${esc(v.roundInfo.title)}</p>
      ${sub ? `
        <div class="done-badge pop">✓ ${sub.byDefault ? '기본 선택 적용' : '제출 완료'}</div>
        <p class="sentence">${sentenceHtml(sub)}</p>
        <p class="reason-show">그 이유는 <em>${esc(sub.reason)}</em> 때문입니다.</p>
        ${sub.predictionLabel ? `<p class="reason-show">다른 기업 예상: <em>${esc(sub.predictionLabel)}</em></p>` : ''}
        ${sub.cost ? `<p class="spent">${spentLabel} ${won(sub.cost)}을 사용했어요.</p>` : ''}
      ` : '<h1>아직 제출하지 않았어요</h1>'}
      <p class="wait">${k === 'responses'
        ? '모든 기업의 선택과 이유가 <b>TV에 공개</b>되었어요. 선생님과 이야기를 나눠 보세요.'
        : `<b data-live="submitted">${v.submittedCount}</b> / ${v.totalTeams} 기업 결정 완료 · TV 화면을 보며 기다려 주세요<span class="waiting-dots"></span>`}</p>
    </section>`;
}

function renderResult(v) {
  const r = v.myResult;
  const round = v.roundInfo.round;
  const spentLabel = round === 2 ? '광고비' : round === 3 ? '생산비' : '사용한 돈';
  let chg = '';
  if (r.rankBefore) {
    const d = r.rankBefore - r.rankAfter;
    chg = d > 0 ? `<span class="chg up">▲ ${d}계단</span>` : d < 0 ? `<span class="chg down">▼ ${-d}계단</span>` : '<span class="chg same">그대로</span>';
  }
  main.innerHTML = `
    <section class="center-wrap">
      <p class="eyebrow">ROUND ${round} 결과</p>
      <h1>이번 라운드 판매 결과</h1>
      ${round === 4 && v.collusion ? `<p class="lead">공동 제안 참여 <b>${v.collusion.count} / ${v.collusion.total}</b> 기업 · 우리 판매 가격 <b>${won(r.price)}</b></p>` : ''}
      <div class="result-card pop">
        <div class="r-row"><span>이번 라운드</span><b>슬랑이 <span class="num" id="r-units">0</span>개 판매</b></div>
        <div class="money num" id="r-rev">+0원</div>
        ${r.spent ? `<div class="r-row"><span>이번 라운드 ${spentLabel}</span><b class="neg num">−${won(r.spent)}</b></div>` : ''}
        <hr>
        <div class="profit-line"><span>이윤</span><span><span class="num muted">${signedWon(r.profitBefore)}</span><span class="arrow">→</span><b class="num ${r.profitAfter >= 0 ? 'pos' : 'neg'}" id="r-profit">${signedWon(r.profitBefore)}</b></span></div>
        <div class="rank-line">${r.rankBefore ? `<span class="muted">${r.rankBefore}위</span><span class="muted">→</span>` : '<span class="muted">현재 순위</span>'}
          <span class="to">${medal(r.rankAfter)} ${r.rankAfter}위</span>${chg}</div>
      </div>
    </section>`;
  animateNumber($('#r-units'), 0, r.units, { duration: 1000 });
  animateNumber($('#r-rev'), 0, r.revenue, { duration: 1200, format: (n) => `+${won(n)}` });
  setTimeout(() => animateNumber($('#r-profit'), r.profitBefore, r.profitAfter, { duration: 1200, format: signedWon }), 600);
}

function renderFinal(v) {
  const me = v.standings.find((x) => x.teamId === v.me.id);
  main.innerHTML = `
    <section class="center-wrap">
      <p class="eyebrow">돌멩민국 슬랑이 시장 · 최종 결과</p>
      <h1>${esc(v.me.name)}의 최종 이윤 순위</h1>
      <div class="final-rank pop">${medal(me.rank)} ${me.rank}위</div>
      <p class="lead">최종 이윤 <b class="num ${me.profit >= 0 ? 'pos' : 'neg'}">${signedWon(me.profit)}</b></p>
      <div class="final-list">
        ${v.standings.map((x) => `
          <div class="fr ${x.teamId === v.me.id ? 'me' : ''}"><span class="rk">${medal(x.rank) || ''}${x.rank}위</span>
          <span class="dot" style="--c:${x.color}"></span><span class="nm">${esc(x.name)}</span><span class="num">${signedWon(x.profit)}</span></div>`).join('')}
      </div>
    </section>`;
}

function renderTv() {
  main.innerHTML = `
    <section class="center-wrap tv-note fade-up">
      <div class="tv">📺</div>
      <h1>TV 화면을 함께 봐요</h1>
      <p>선생님의 안내를 기다려 주세요.</p>
    </section>`;
}

// ── 정리: 다시 경영한다면? ─────────────────────────────
function renderReflectionForm(v) {
  const rf = v.reflection;
  loadForm(`${v.sessionId}:${v.me.id}:reflection`);
  main.innerHTML = `
    <div class="round-head fade-up"><span class="round-tag">정리</span><h1>${esc(rf.title)}</h1></div>
    <p class="step-label"><span class="n">1</span>${esc(rf.question)} <span class="muted">바꾸고 싶은 선택 하나를 고르세요.</span></p>
    <div class="decisions" id="decs">
      ${rf.decisions.map((d) => `
        <button class="decision" data-target="${d.target}" aria-pressed="false">
          <div class="dl">${esc(d.decisionLabel)}</div><div class="dv">${esc(d.currentLabel)}</div>
        </button>`).join('')}
    </div>
    <div id="step2"></div>
    <div class="panel">
      <p class="sentence" id="rsentence"></p>
      <p class="sentence">그 이유는</p>
      <div class="reason-line">
        <textarea id="reason" maxlength="${v.limits.max}" rows="2" placeholder="바꾸고 싶은 이유를 직접 써 주세요"></textarea>
        <span class="because">때문입니다.</span>
      </div>
      <p class="count"><span id="cnt">0</span> / ${v.limits.max}</p>
      <div class="hints"><b>생각 도움</b>${rf.hints.map((h) => `<span>· ${esc(h)}</span>`).join('')}</div>
    </div>
    <div class="submit-row"><span class="why" id="why"></span><button class="btn accent big" id="submit">제출하기</button></div>`;

  const reason = $('#reason');
  reason.value = form.reason || '';
  const dec = () => rf.decisions.find((d) => d.target === form.target);
  const renderStep2 = () => {
    const d = dec();
    if (!d) {
      $('#step2').innerHTML = '';
      return;
    }
    $('#step2').innerHTML = `
      <p class="step-label"><span class="n">2</span>${esc(withJosa(d.decisionLabel, '을'))} 무엇으로 바꿀까요?</p>
      <div class="options" style="--cols:${d.options.length}" id="newopts">
        ${d.options.map((o) => {
          const was = String(o.value) === String(d.current);
          return `<button class="opt ${was ? 'was' : ''}" data-value="${esc(o.value)}" aria-pressed="false" ${was ? 'disabled' : ''}>
            ${was ? '<span class="was-tag">원래 선택</span>' : ''}<b class="opt-label">${esc(o.label)}</b><p>${esc(o.desc)}</p></button>`;
        }).join('')}
      </div>`;
    $$('#newopts .opt').forEach((b) => b.addEventListener('click', () => {
      form.choice = b.dataset.value;
      saveForm();
      update();
    }));
  };
  const update = () => {
    const d = dec();
    $$('#decs .decision').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.target === form.target)));
    $$('#newopts .opt').forEach((b) => b.setAttribute('aria-pressed', String(String(b.dataset.value) === String(form.choice))));
    const opt = d?.options.find((o) => String(o.value) === String(form.choice) && String(o.value) !== String(d.current));
    $('#rsentence').innerHTML = d && opt
      ? `우리 기업은 ${esc(withJosa(d.decisionLabel, '을'))} <strong>${esc(d.currentLabel)} → ${esc(opt.label)}</strong>${josa(opt.label, '으로')} 바꾸고 싶습니다.`
      : '우리 기업은 <strong class="empty">바꿀 선택과 새 선택지를 골라 주세요</strong>';
    $('#cnt').textContent = reason.value.length;
    let why = '';
    if (!d) why = '바꿀 선택을 골라 주세요';
    else if (!opt) why = '새로운 선택지를 골라 주세요';
    else if (reason.value.trim().length < v.limits.min) why = '이유를 써 주세요';
    $('#why').textContent = why;
    $('#submit').disabled = !!why || busy;
  };
  $$('#decs .decision').forEach((b) => b.addEventListener('click', () => {
    if (form.target !== b.dataset.target) form.choice = null;
    form.target = b.dataset.target;
    saveForm();
    renderStep2();
    update();
  }));
  reason.addEventListener('input', () => {
    form.reason = reason.value;
    saveForm();
    update();
  });
  $('#submit').addEventListener('click', async () => {
    if (busy || !confirm('제출할까요? 제출한 뒤에는 바꿀 수 없어요.')) return;
    busy = true;
    $('#submit').disabled = true;
    try {
      const r = await api('/api/play/reflect', { token, target: form.target, choice: form.choice, reason: reason.value });
      clearForm();
      busy = false;
      if (r.view) onState(r.view);
    } catch (e) {
      busy = false;
      toast(e.message, { error: true, ms: 4000 });
      if ($('#submit')) update();
    }
  });
  renderStep2();
  update();
}

function renderReflectionDone(v) {
  const mine = v.reflection?.mine;
  const closing = v.step.kind === 'closing';
  main.innerHTML = `
    <section class="center-wrap fade-up">
      <p class="eyebrow">정리 · 다시 경영한다면?</p>
      ${mine ? `
        ${closing ? '' : '<div class="done-badge pop">✓ 제출 완료</div>'}
        <p class="lead">우리 기업은 <b>${esc(withJosa(mine.decisionLabel, '을'))}</b> 이렇게 바꾸고 싶어요.</p>
        <p class="change-show"><span class="from">${esc(mine.fromLabel)}</span> → ${esc(mine.toLabel)}</p>
        <p class="reason-show">그 이유는 <em>${esc(mine.reason)}</em> 때문입니다.</p>
      ` : '<h1>선생님의 안내를 기다려 주세요</h1>'}
      ${closing
        ? `<p class="closing-line">${v.closing.map(esc).join('<br>')}</p>`
        : `<p class="wait"><b data-live="submitted">${v.submittedCount}</b> / ${v.totalTeams} 기업 제출 완료 · TV 화면을 함께 봐요</p>`}
    </section>`;
}

startLive();
