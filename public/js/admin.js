// 교사 콘솔 /admin — 모든 진행은 여기서 버튼으로만 (자동 진행 없음)
import { $, $$, esc, won, signedWon, fmt, connectStream, api, toast, netBanner, storage } from './common.js';

const PIN_KEY = 'slangi.adminPin';
let pin = storage.get(PIN_KEY) || '';
let view = null;
let stream = null;
let busy = false;

// ── 로그인 ────────────────────────────────────────────
async function tryLogin(p) {
  await api('/api/admin/login', {}, { 'x-admin-pin': p });
  pin = p;
  storage.set(PIN_KEY, p);
  $('#login').classList.add('hidden');
  $('#app').classList.remove('hidden');
  stream?.close();
  stream = connectStream({ role: 'admin', pin }, { onState, onStatus: netBanner });
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
if (pin) tryLogin(pin).catch(showLogin);
else showLogin();

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
  if (v.nextAction.warning && !confirm(`${v.nextAction.warning}\n\n그래도 진행할까요?`)) return;
  act('next', { from: v.step.id, fromReveal: v.revealIndex });
}
function goPrev() {
  const v = view;
  if (!v?.prevLabel) return;
  act('prev', { from: v.step.id, fromReveal: v.revealIndex });
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
}

function renderTop(v) {
  const el = $('#top-score');
  el.textContent = v.social.score;
  el.classList.toggle('neg', v.social.score < 0);
}

function renderNav(v) {
  const st = v.step;
  const na = v.nextAction;
  const scoreProg = st.kind === 'score' ? ` (${v.revealIndex} / ${v.scoreItemsTotal} 항목 공개)` : '';
  const computed = st.round && v.rounds[st.round]?.computed;
  const idx = v.steps.findIndex((x) => x.current);
  let extra = '';
  if (na?.warning) extra += `<div class="warn">⚠ ${esc(na.warning)}</div>`;
  if (computed && ['meeting', 'responses'].includes(st.kind)) extra += '<div class="info">이 라운드는 이미 결과가 계산되었습니다. 다시 계산되지 않습니다.</div>';
  if (st.kind === 'video') {
    extra += `<div class="video-ctl">
      <button class="btn accent" id="v-play" ${v.video.available ? '' : 'disabled'}>▶ 영상 재생${v.video.nonce ? ' (처음부터)' : ''}</button>
      <button class="btn ghost" id="v-stop" ${v.video.available ? '' : 'disabled'}>■ 정지</button>
      <span class="muted">${v.video.available
        ? '재생이 끝나면 마지막 화면에서 멈춥니다. 교사가 [다음]을 눌러야 넘어갑니다.'
        : '영상 파일이 없어 TV에 대체 뉴스 슬라이드가 표시됩니다. (public/videos/social-impact.mp4 에 넣으면 자동 사용)'}</span></div>`;
  }
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
      <button class="btn next" id="next" ${na && !busy ? '' : 'disabled'}>${na ? esc(na.label) : '마지막 단계입니다'} ▶</button>
    </div>
    <div class="progress">${v.steps.filter((x) => x.available).map((x) => `<i class="${x.current ? 'cur' : x.index < idx ? 'done' : ''}" title="${esc(x.label)}"></i>`).join('')}</div>`;
  $('#next').addEventListener('click', goNext);
  $('#prev').addEventListener('click', goPrev);
  $('#v-play')?.addEventListener('click', () => act('video', { command: 'play' }));
  $('#v-stop')?.addEventListener('click', () => act('video', { command: 'stop' }));
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
    if (confirm(`${t.name}의 노트북 연결을 해제할까요?\n게임 기록은 그대로 남고, 학생이 /play 에서 이 기업을 다시 선택하면 이어서 할 수 있습니다.`)) act('release', { teamId: t.id });
  }));
}

function renderSteps(v) {
  const idx = v.steps.findIndex((x) => x.current);
  let group = '';
  const html = v.steps.map((s) => {
    const g = s.round ? `${s.round}라운드` : s.kind.startsWith('reflection') || s.kind === 'closing' ? '정리' : s.dark ? '사회적 영향 공개' : '';
    const head = g && g !== group ? `<li class="group">${g}</li>` : '';
    group = g || group;
    const cls = s.current ? 'cur' : !s.available ? 'off' : s.index < idx ? 'done' : '';
    const tag = s.conditional ? `<span class="tag">${s.available ? '발생함' : '발생 시'}</span>` : '';
    return `${head}<li class="${cls}"><button data-step="${s.id}" ${s.current ? 'disabled' : ''}>${esc(s.label)}${tag}</button></li>`;
  }).join('');
  $('#steps').innerHTML = html;
  $$('#steps [data-step]').forEach((b) => b.addEventListener('click', () => {
    const s = v.steps.find((x) => x.id === b.dataset.step);
    const extra = s.index > idx ? '\n(건너뛴 라운드의 미제출 모둠에는 기본 선택이 적용되어 계산됩니다)' : '';
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
function openDialog(title, bodyHtml, onOk) {
  const dlg = $('#dlg');
  $('#dlg-title').textContent = title;
  $('#dlg-body').innerHTML = bodyHtml;
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
  if (confirm('이동할까요? (계산되지 않은 라운드는 미제출 기본값으로 계산됩니다)')) act('goto', { stepId: b.dataset.goto });
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
  }
});

// TV 미리보기 크기 맞추기
function fitPreview() {
  const box = $('.preview');
  const f = $('#preview');
  if (box && f) f.style.transform = `scale(${box.clientWidth / 1280})`;
}
window.addEventListener('resize', fitPreview);
