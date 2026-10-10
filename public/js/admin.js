// 교사 콘솔 /admin — 모든 진행은 여기서 버튼으로만 (자동 진행 없음)
import { $, $$, esc, won, signedWon, fmt, connectLive, api, toast, netBanner, storage, meetingTimer, timerHtml } from './common.js';

const PIN_KEY = 'slangi.adminPin';
let pin = storage.get(PIN_KEY) || '';
let view = null;
let stream = null;
let busy = false;
const clock = meetingTimer(); // 기업 회의 타이머 (서버 상태 기준 — 학생·TV 와 같은 시간)

// ── 로그인 ────────────────────────────────────────────
async function tryLogin(p) {
  await api('/api/admin/login', {}, { 'x-admin-pin': p });
  pin = p;
  storage.set(PIN_KEY, p);
  $('#login').classList.add('hidden');
  $('#app').classList.remove('hidden');
  stream?.close();
  stream = connectLive({ role: 'admin', headers: () => ({ 'x-admin-pin': pin }) }, {
    onState,
    onStatus: netBanner,
    onAuthError: () => {
      stream?.close();
      showLogin();
    },
  });
  fitPreview();
}
function showLogin() {
  $('#app').classList.add('hidden');
  $('#login').classList.remove('hidden');
  $('#pin').focus();
}
$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await tryLogin($('#pin').value.trim());
  } catch (err) {
    toast(err.message, { error: true });
  }
});
$('#logout').addEventListener('click', () => {
  storage.del(PIN_KEY);
  stream?.close();
  showLogin();
});
if (pin) {
  tryLogin(pin).catch((e) => {
    if (e.status === 401 || e.status === 429) return showLogin();
    // 인터넷 문제로 확인을 못 한 경우: 저장된 PIN 으로 잠시 뒤 다시 시도
    toast(e.message, { error: true });
    showLogin();
    $('#pin').value = pin;
  });
} else showLogin();

// ── 명령 ─────────────────────────────────────────────
async function act(action, body = {}, { silent = false } = {}) {
  if (busy) return null;
  busy = true;
  document.body.classList.add('busy');
  $$('.nav-btns .btn').forEach((b) => { b.disabled = true; });
  try {
    const r = await api('/api/admin/action', { action, ...body }, { 'x-admin-pin': pin });
    if (r.view) onState(r.view);
    return r;
  } catch (e) {
    if (!silent) toast(e.message, { error: true, ms: 4000 });
    if (e.status === 401) showLogin();
    return null;
  } finally {
    busy = false;
    document.body.classList.remove('busy');
    if (view) renderNav(view);
  }
}

function goNext() {
  const v = view;
  if (!v?.nextAction) return;
  // 미제출 기업이 있으면 자동 기본값 없이, 교사가 선택을 지정해야 결과를 계산할 수 있음
  if (v.nextAction.assign) return openAssignDialog(v);
  if (v.nextAction.warning && !confirm(`${v.nextAction.warning}\n\n그래도 진행할까요?`)) return;
  act('next', { from: v.step.id, fromReveal: v.revealIndex, ...hintGuard(v) });
}
function goPrev() {
  const v = view;
  if (!v?.prevLabel) return;
  act('prev', { from: v.step.id, fromReveal: v.revealIndex, ...hintGuard(v) });
}
// 도입 퀴즈(Q2·Q3): 지금 보고 있는 힌트 상태를 함께 보내 TV 리모컨과 동시에 눌러도 한 단계만 진행
const hintGuard = (v) => (v.quiz?.type === 'blank' ? { fromHint: v.quiz.hint } : {});
function toggleHint() {
  const v = view;
  if (v?.quiz?.type !== 'blank' || v.quiz.phase === 'answer') return;
  act('hint', { from: v.step.id, on: !v.quiz.hint });
}

// ── 렌더 ─────────────────────────────────────────────
function onState(v) {
  if (view && v.sessionId === view.sessionId && v.rev < view.rev) return;
  view = v;
  renderTop(v);
  renderNav(v);
  renderTeams(v);
  renderSteps(v);
  renderHistory(v);
  renderSocial(v);
  renderLog(v);
  renderScenarios(v);
  clock.set(v.timer);
}

function renderTop(v) {
  const el = $('#top-score');
  el.textContent = v.social.score;
  el.classList.toggle('neg', v.social.score < 0);
}

function renderNav(v) {
  const st = v.step;
  const na = v.nextAction;
  let scoreProg = '';
  if (st.kind === 'score') {
    const cur = v.scorePhases.find((p) => p.current);
    if (cur) scoreProg = ` (${cur.label})`;
  }
  const computed = st.round && v.rounds[st.round]?.computed;
  const idx = v.steps.findIndex((x) => x.current);
  let extra = '';
  if (na?.warning) extra += `<div class="warn">⚠ ${esc(na.warning)}</div>`;
  if (st.kind === 'score') {
    // TV 사회점수 공개가 어디까지 왔는지 (TV 키보드 진행과 같은 단계)
    extra += `<div class="phases">${v.scorePhases.map((p) => `<span class="ph ${p.current ? 'cur' : p.done ? 'done' : ''} ${p.skipped ? 'skip' : ''}">${esc(p.label)}${p.skipped ? '<small>감점 없음 · 건너뜀</small>' : ''}</span>`).join('<i>›</i>')}</div>`;
  }
  if (v.quiz) {
    // 도입 퀴즈 공개 단계: 문제만 → (초성 힌트) → 정답
    const phases = [['question', '문제만'], ...(v.quiz.type === 'blank' ? [['hint', '초성 힌트 공개']] : []), ['answer', '정답 공개']];
    const at = phases.findIndex(([k]) => k === v.quiz.phase);
    extra += `<div class="phases">${phases.map(([, label], i) => `<span class="ph ${i === at ? 'cur' : i < at ? 'done' : ''}">${label}</span>`).join('<i>›</i>')}</div>`;
    if (v.quiz.type === 'blank') {
      extra += `<div class="quiz-tools"><button class="btn small ${v.quiz.hint ? '' : 'ghost'}" id="hint" ${v.quiz.phase === 'answer' || busy ? 'disabled' : ''}>${v.quiz.hint ? '초성 힌트 숨기기' : '💡 초성 힌트 보이기'} (H)</button>
        <span class="muted">힌트 없이 [정답 공개]를 바로 눌러도 됩니다.</span></div>`;
    }
  }
  if (v.timer) {
    // 기업 회의 타이머: 세 화면이 같은 시간. 0이 되어도 자동 제출하지 않음 (00:00 으로 멈춤)
    const dis = busy ? 'disabled' : '';
    extra += `<div class="timer-box">
      ${timerHtml('admin-timer', '남은 회의 시간')}
      <div class="timer-btns">
        <button class="btn small ghost" data-timer-add="-60" ${dis}>−1분</button>
        <button class="btn small ghost" data-timer-add="-30" ${dis}>−30초</button>
        <button class="btn small ghost" data-timer-add="30" ${dis}>+30초</button>
        <button class="btn small ghost" data-timer-add="60" ${dis}>+1분</button>
        <i></i>
        <button class="btn small ghost" data-timer-op="${v.timer.paused ? 'resume' : 'pause'}" ${dis}>${v.timer.paused ? '▶ 다시 시작' : '⏸ 일시정지'}</button>
        <button class="btn small ghost" data-timer-op="reset" ${dis}>2분으로</button>
      </div>
    </div>`;
  }
  if (computed && ['meeting', 'responses'].includes(st.kind)) extra += '<div class="info">이 라운드는 이미 결과가 계산되었습니다. 다시 계산되지 않습니다.</div>';
  if (st.kind === 'meeting' || st.kind === 'reflection') {
    const n = st.kind === 'reflection' ? v.reflections.filter((r) => r.submitted).length : Object.values(v.submissions[st.round]).filter(Boolean).length;
    extra = `<div class="info">제출 현황: <b>${n} / 5</b></div>${extra}`;
  }
  $('#nav').innerHTML = `
    <div class="nav-now">
      <div class="box"><div class="k">현재 TV 화면</div><div class="v">${esc(st.label)}${scoreProg}</div></div>
      <div class="box next"><div class="k">다음</div><div class="v">${na ? esc(na.toLabel) : '끝'}</div></div>
    </div>
    ${extra}
    <div class="nav-btns">
      <button class="btn ghost prev" id="prev" ${v.prevLabel && !busy ? '' : 'disabled'}>◀ 이전</button>
      <button class="btn next" id="next" ${na && !busy ? '' : 'disabled'}>${na ? (na.assign ? '미제출 기업 선택 지정하고 ' : '') + esc(na.label) : '마지막 단계입니다'} ▶</button>
    </div>
    <div class="progress">${v.steps.filter((x) => x.available).map((x) => `<i class="${x.current ? 'cur' : x.index < idx ? 'done' : ''}" title="${esc(x.label)}"></i>`).join('')}</div>`;
  $('#next').addEventListener('click', goNext);
  $('#prev').addEventListener('click', goPrev);
  $('#hint')?.addEventListener('click', toggleHint);
  $$('[data-timer-add]', $('#nav')).forEach((b) => b.addEventListener('click', () => act('timer', { from: st.id, op: 'add', sec: Number(b.dataset.timerAdd) })));
  $$('[data-timer-op]', $('#nav')).forEach((b) => b.addEventListener('click', () => act('timer', { from: st.id, op: b.dataset.timerOp })));
  clock.paint();
}

function connCell(t) {
  if (t.connections > 1) return `<span class="conn warn2">● ${t.connections}대 접속</span>`;
  if (t.connections === 1) return '<span class="conn on">● 접속</span>';
  if (t.virtual) return '<span class="conn virtual">● 테스트</span>';
  if (t.claimed) return '<span class="conn off">○ 끊김</span>';
  return '<span class="conn muted">미선택</span>';
}

function renderTeams(v) {
  const st = v.step;
  const r = st.round;
  const inReflection = ['reflection', 'reflectionResponses', 'closing'].includes(st.kind);
  const computed = r && v.rounds[r]?.computed;
  let subHead = '선택 요약';
  if (r) subHead = `${r}라운드 제출 (선택 · 이유)`;
  if (inReflection) subHead = '정리 활동 제출';
  $('#teams-sub').textContent = r ? (computed ? `${r}라운드 계산 완료` : `${r}라운드 진행 중`) : '';

  const rows = v.teams.map((t) => {
    let subCell = '';
    let actions = '';
    if (r) {
      const s = v.submissions[r][t.id];
      subCell = s
        ? `<div class="sub-choice">${esc(s.choiceLabel)}${s.byAdmin ? '<span class="badge">대신 입력</span>' : ''}${s.byDefault ? '<span class="badge warn">미제출 기본값</span>' : ''}
            ${s.predictionLabel ? `<span class="badge">예상: ${esc(s.predictionLabel)}</span>` : ''}</div><div class="sub-reason">${esc(s.reason)}</div>`
        : '<span class="sub-none">아직 제출하지 않음</span>';
      if (!computed) {
        actions += `<button class="btn small ghost" data-submit-for="${t.id}">${s ? '대신 수정' : '대신 제출'}</button>`;
        if (s) actions += `<button class="btn small ghost" data-clear="${t.id}" data-round="${r}">제출 초기화</button>`;
      }
    } else if (inReflection) {
      const f = v.reflections.find((x) => x.teamId === t.id);
      subCell = f?.submitted
        ? `<div class="sub-choice">${esc(f.decisionLabel)}: ${esc(f.fromLabel)} → ${esc(f.toLabel)}</div><div class="sub-reason">${esc(f.reason)}</div>`
        : '<span class="sub-none">아직 제출하지 않음</span>';
      actions += `<button class="btn small ghost" data-reflect-for="${t.id}">대신 ${f?.submitted ? '수정' : '제출'}</button>`;
      if (f?.submitted) actions += `<button class="btn small ghost" data-clear="${t.id}" data-round="reflection">제출 초기화</button>`;
    } else {
      const c = t.choices;
      subCell = `<span class="muted">${[c.price, c.ad, c.production, c.collusion && `공동제안 ${c.collusion}`].filter(Boolean).map(esc).join(' · ') || '-'}</span>`;
    }
    if (t.claimed) actions += `<button class="btn small ghost" data-release="${t.id}" title="다른 노트북으로 다시 접속해야 할 때">연결 해제</button>`;
    return `<tr>
      <td><div class="nm"><span class="dot" style="--c:${t.color}"></span>${esc(t.name)}</div>${connCell(t)}</td>
      <td class="num">${won(t.cash)}</td>
      <td class="num">${won(t.revenueTotal)}</td>
      <td class="num"><b class="${t.profit >= 0 ? 'pos' : 'neg'}">${signedWon(t.profit)}</b><div class="muted">${t.rank ? `${t.rank}위` : '-'}</div></td>
      <td>${subCell}</td>
      <td><div class="acts">${actions}</div></td>
    </tr>`;
  }).join('');
  $('#teams').innerHTML = `<thead><tr><th>기업 · 접속</th><th class="num">현재 가진 돈</th><th class="num">판 돈(누적)</th><th class="num">이윤 · 순위</th><th>${subHead}</th><th></th></tr></thead><tbody>${rows}</tbody>`;

  $$('[data-submit-for]').forEach((b) => b.addEventListener('click', () => openSubmitDialog(Number(b.dataset.submitFor))));
  $$('[data-reflect-for]').forEach((b) => b.addEventListener('click', () => openReflectDialog(Number(b.dataset.reflectFor))));
  $$('[data-clear]').forEach((b) => b.addEventListener('click', () => {
    const t = v.teams.find((x) => x.id === Number(b.dataset.clear));
    if (confirm(`${t.name}의 제출을 초기화할까요?\n(사용한 비용은 돌려주고, 학생이 다시 제출할 수 있습니다)`)) act('clearSubmission', { teamId: t.id, round: b.dataset.round });
  }));
  $$('[data-release]').forEach((b) => b.addEventListener('click', () => {
    const t = v.teams.find((x) => x.id === Number(b.dataset.release));
    if (confirm(`${t.name}의 노트북 연결을 해제할까요?\n게임 기록은 그대로 남고, 학생이 사이트 첫 화면에서 이 기업을 다시 선택하면 이어서 할 수 있습니다.`)) act('release', { teamId: t.id });
  }));
}

function renderSteps(v) {
  const idx = v.steps.findIndex((x) => x.current);
  let group = '';
  const html = v.steps.map((s) => {
    const g = s.group ? s.group : s.kind === 'lesson' ? '도입' : s.kind === 'intro' ? '활동 1 · 기업 경영 시뮬레이션' : s.round ?`${s.round}라운드` : s.kind.startsWith('reflection') || s.kind === 'closing' ? '정리' : s.dark ? '사회적 영향 공개' : '';
    const head = g && g !== group ? `<li class="group">${g}</li>` : '';
    group = g || group;
    const cls = s.current ? 'cur' : !s.available ? 'off' : s.index < idx ? 'done' : '';
    const tag = s.conditional ? `<span class="tag">${s.available ? '발생함' : '발생 시'}</span>` : '';
    return `${head}<li class="${cls}"><button data-step="${s.id}" ${s.current ? 'disabled' : ''}>${esc(s.label)}${tag}</button></li>`;
  }).join('');
  $('#steps').innerHTML = html;
  $$('#steps [data-step]').forEach((b) => b.addEventListener('click', () => {
    const s = v.steps.find((x) => x.id === b.dataset.step);
    const extra = s.index > idx ? '\n(건너뛴 라운드에 미제출 기업이 있으면 이동하지 않습니다. 먼저 [대신 제출]로 선택을 지정해 주세요)' : '';
    if (confirm(`'${s.label}' 단계로 이동할까요?${extra}`)) act('goto', { stepId: s.id });
  }));
  const cur = $('#steps li.cur');
  if (cur && !renderSteps.scrolled) {
    cur.scrollIntoView({ block: 'center' });
    renderSteps.scrolled = true;
  }
}

function renderHistory(v) {
  if (!$('#history-box').open) return;
  const html = [1, 2, 3, 4].map((r) => {
    const rd = v.rounds[r];
    const opts = v.roundOptions[r];
    const rows = v.teams.map((t) => {
      const s = v.submissions[r][t.id];
      const res = rd.computed ? rd.results[t.id] : null;
      const inr = res?.internal;
      return `<tr><td>${esc(t.name)}</td><td>${s ? esc(s.choiceLabel) : '-'}</td><td>${s ? esc(s.reason) : ''}</td>
        <td class="num">${res ? fmt(res.units) : ''}</td><td class="num">${res ? won(res.revenue) : ''}</td><td class="num">${res && res.spent ? `−${won(res.spent)}` : ''}</td>
        <td class="num">${res ? signedWon(res.profitAfter) : ''}</td><td class="num">${res ? `${res.rankAfter}위` : ''}</td>
        <td class="internal">${inr ? `기본 ${inr.base} × 상대가격 ${inr.rel} × 광고 ${inr.adMult} × 담합 ${inr.extra} × 변동 ${inr.variance}` : ''}</td></tr>`;
    }).join('');
    const col = rd.collusion ? ` — 공동 제안 참여 ${rd.collusion.count}곳` : '';
    return `<h3>${r}라운드 · ${esc(opts.title)} ${rd.computed ? '(계산 완료)' : '(계산 전)'}${col}</h3>
      <div class="table-wrap"><table class="hist"><thead><tr><th>기업</th><th>선택</th><th>이유</th><th class="num">판매량</th><th class="num">판 돈</th><th class="num">비용</th><th class="num">이윤</th><th class="num">순위</th><th>내부 계산</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }).join('');
  $('#history').innerHTML = `<div class="hist">${html}</div>`;
}
$('#history-box').addEventListener('toggle', () => view && renderHistory(view));

function renderSocial(v) {
  if (!$('#social-box').open) return;
  const s = v.social;
  const items = s.items.map((it) => `<tr><td>${esc(it.categoryLabel)}</td><td>${esc(it.title)}${it.companies.length ? ` <span class="muted">(${it.companies.map((c) => esc(c.name)).join(', ')})</span>` : ''}</td>
    <td class="num neg">${it.delta}</td><td class="num">${it.before} → ${it.after}</td></tr>`).join('');
  const news = Object.values(v.news).filter(Boolean).map((n) => `<div class="news-prev"><b>[${esc(n.category)}] ${esc(n.headline)}</b>${n.lines.map((l) => `<p>${esc(l)}</p>`).join('')}</div>`).join('');
  $('#social').innerHTML = `
    <div class="social-top"><span class="muted">돌멩민국 사회점수</span><b class="${s.score < 0 ? 'neg' : ''}">${s.score}</b><span class="muted">시작 ${s.start}</span></div>
    ${items ? `<table><thead><tr><th>분야</th><th>원인</th><th class="num">변화</th><th class="num">점수</th></tr></thead><tbody>${items}</tbody></table>` : '<p class="muted">아직 사회점수 변화가 없습니다.</p>'}
    ${news || '<p class="muted">생성된 뉴스가 없습니다. (광고·생산·공동 제안 결과가 계산되면 생성)</p>'}`;
}
$('#social-box').addEventListener('toggle', () => view && renderSocial(view));

function renderLog(v) {
  $('#log').innerHTML = v.log.map((l) => `<li><time>${new Date(l.at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time>${esc(l.msg)}</li>`).join('');
}

function renderScenarios(v) {
  const sel = $('#scenario');
  if (sel.options.length) return;
  sel.innerHTML = v.scenarios.map((s) => `<option value="${s.key}">${esc(s.label)}</option>`).join('');
}

// ── 대신 제출 대화상자 ─────────────────────────────────
function openDialog(title, bodyHtml, onOk, { okLabel = '제출' } = {}) {
  const dlg = $('#dlg');
  $('#dlg-title').textContent = title;
  $('#dlg-body').innerHTML = bodyHtml;
  $('#dlg-ok').textContent = okLabel;
  dlg.onclose = () => {
    if (dlg.returnValue === 'ok') onOk(new FormData($('#dlg-form')));
  };
  dlg.returnValue = '';
  dlg.showModal();
}

function openSubmitDialog(teamId) {
  const v = view;
  const r = v.step.round;
  const ri = v.roundOptions[r];
  const t = v.teams.find((x) => x.id === teamId);
  const cur = v.submissions[r][teamId];
  const body = `
    <p class="muted">${r}라운드 · ${esc(ri.title)} — 현재 가진 돈 ${won(t.cash + (cur?.cost || 0))}</p>
    <label>선택</label>
    <div class="radio-list">${ri.options.map((o) => `<label><input type="radio" name="choice" value="${esc(o.value)}" ${cur && String(cur.choice) === String(o.value) ? 'checked' : ''}>
      ${esc(o.label)}${o.cost ? ` <span class="muted">(${won(o.cost)})</span>` : ''}</label>`).join('')}</div>
    ${ri.prediction ? `<label>다른 기업 예상</label><select name="prediction"><option value="">(없음)</option>${ri.prediction.options.map((o) => `<option value="${o.value}">${esc(o.label)}</option>`).join('')}</select>` : ''}
    <label>이유 (학생이 말한 내용을 적어 주세요)</label>
    <textarea name="reason" rows="2" maxlength="${v.config.REASON_MAX_LENGTH}">${cur && !cur.byDefault ? esc(cur.reason) : ''}</textarea>`;
  openDialog(`${t.name} 대신 제출`, body, (fd) => {
    if (!fd.get('choice')) return toast('선택지를 골라 주세요.', { error: true });
    act('submitFor', { teamId, round: r, choice: fd.get('choice'), reason: fd.get('reason'), prediction: fd.get('prediction') || null });
  });
}

// 미제출 기업 선택 지정 → 바로 진행 (자동 기본값 없음)
function openAssignDialog(v) {
  const { round, teamIds } = v.nextAction.assign;
  const ri = v.roundOptions[round];
  const body = `
    <p class="warn">${esc(v.nextAction.warning)}</p>
    ${teamIds.map((id) => {
      const t = v.teams.find((x) => x.id === id);
      return `<fieldset class="assign">
        <legend><span class="dot" style="--c:${t.color}"></span>${esc(t.name)} <span class="muted">현재 가진 돈 ${won(t.cash)}</span></legend>
        <div class="radio-list">${ri.options.map((o) => `<label><input type="radio" name="t${id}" value="${esc(o.value)}" required ${(o.cost || 0) > t.cash ? 'disabled' : ''}>
          ${esc(o.label)}${o.cost ? ` <span class="muted">(${won(o.cost)})</span>` : ''}</label>`).join('')}</div>
      </fieldset>`;
    }).join('')}`;
  openDialog(`${round}라운드 · 미제출 기업 선택 지정`, body, (fd) => {
    const assign = {};
    for (const id of teamIds) {
      const c = fd.get(`t${id}`);
      if (!c) return toast('미제출 기업의 선택을 모두 지정해 주세요.', { error: true });
      assign[id] = c;
    }
    act('next', { from: v.step.id, fromReveal: v.revealIndex, assign });
  }, { okLabel: '지정하고 진행' });
}

function openReflectDialog(teamId) {
  const v = view;
  const t = v.teams.find((x) => x.id === teamId);
  const targets = [['price', 1], ['ad', 2], ['production', 3], ['collusion', 4]];
  const body = `
    <label>바꿀 선택 → 새 선택지</label>
    <select name="pair">${targets.map(([k, r]) => v.roundOptions[r].options.map((o) => `<option value="${k}|${esc(o.value)}">${esc(v.roundOptions[r].decisionLabel)}: ${esc(t.choices[k] ?? '-')} → ${esc(o.label)}</option>`).join('')).join('')}</select>
    <label>이유</label><textarea name="reason" rows="2" maxlength="${v.config.REASON_MAX_LENGTH}"></textarea>`;
  openDialog(`${t.name} 정리 활동 대신 제출`, body, (fd) => {
    const [target, choice] = String(fd.get('pair')).split('|');
    act('reflectFor', { teamId, target, choice, reason: fd.get('reason') });
  });
}

// ── 테스트 패널 / 설정 ───────────────────────────────────
$$('[data-act]').forEach((b) => b.addEventListener('click', () => {
  const a = b.dataset.act;
  if (a === 'testAutoComplete' && !confirm('남은 라운드를 선택한 시나리오로 모두 자동 제출·계산하고 최종 순위로 이동합니다. 진행할까요?')) return;
  act(a, { scenario: $('#scenario').value });
}));
$$('[data-goto]').forEach((b) => b.addEventListener('click', () => {
  if (confirm('이동할까요? (계산되지 않은 라운드에 미제출 기업이 있으면 이동하지 않습니다)')) act('goto', { stepId: b.dataset.goto });
}));
$('#reset').addEventListener('click', () => {
  const keep = $('#keep-claims').checked;
  if (!confirm(`정말 전체 초기화할까요?\n모든 선택·돈·순위·사회점수가 처음으로 돌아갑니다.\n${keep ? '(모둠 노트북 접속은 유지됩니다)' : '(모둠 노트북도 기업을 다시 선택해야 합니다)'}`)) return;
  const typed = prompt("확인을 위해 '초기화'라고 입력하세요.");
  if (typed?.trim() !== '초기화') return toast('초기화를 취소했습니다.');
  renderSteps.scrolled = false;
  act('reset', { keepClaims: keep });
});

const KEYS_KEY = 'slangi.adminKeys';
$('#keys').checked = storage.get(KEYS_KEY) === '1';
$('#keys').addEventListener('change', (e) => storage.set(KEYS_KEY, e.target.checked ? '1' : '0'));
document.addEventListener('keydown', (e) => {
  if (!$('#keys').checked || $('#dlg').open) return;
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
  if (['ArrowRight', 'PageDown'].includes(e.key)) {
    e.preventDefault();
    goNext();
  } else if (['ArrowLeft', 'PageUp'].includes(e.key)) {
    e.preventDefault();
    goPrev();
  } else if (['h', 'H', 'ㅗ'].includes(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
    toggleHint();
  }
});

// TV 미리보기 크기 맞추기
function fitPreview() {
  const box = $('.preview');
  const f = $('#preview');
  if (box && f) f.style.transform = `scale(${box.clientWidth / 1280})`;
}
window.addEventListener('resize', fitPreview);
