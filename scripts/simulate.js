// 밸런스 시뮬레이션: node scripts/simulate.js
// GAME_CONFIG 수치를 바꾼 뒤 실행해서 결과가 의도대로 나오는지 확인하세요.
import { GameEngine } from '../src/engine.js';
import { TEAM_IDS, companyName, optionLabel, won } from '../src/content.js';
import { GAME_CONFIG as C } from '../src/config.js';

const signed = (n) => (n >= 0 ? `+${won(n)}` : `-${won(-n)}`);

function play(choicesByTeam) {
  const g = new GameEngine();
  g.testAutoJoin();
  for (let r = 1; r <= 4; r++) {
    for (const id of TEAM_IDS) {
      g.submit(id, { round: r, choice: choicesByTeam[id][r - 1], reason: 'sim', prediction: 'half' }, { byAdmin: true });
    }
    g.computeRound(r);
  }
  return g;
}

function report(title, choices) {
  const g = play(choices);
  console.log(`\n■ ${title}`);
  for (const x of g.state.standings) {
    const t = g.state.teams[x.teamId];
    const c = t.choices;
    const units = [1, 2, 3, 4].map((r) => g.state.rounds[r].results[x.teamId].units).join('/');
    console.log(
      `  ${x.rank}위 ${companyName(x.teamId).padEnd(6)} 이윤 ${signed(x.profit).padStart(12)}  | ${optionLabel(1, c.price)}, ${optionLabel(2, c.ad)}, ${optionLabel(3, c.production)}, ${c.collusion === 'join' ? '담합참여' : '불참'} | 판매 ${units}`,
    );
  }
  console.log(`  → 돌멩민국 사회점수: ${g.socialScore()}`);
  return g;
}

const P = C.PRICE_OPTIONS;
report('모두 다른 선택', {
  1: [P[0], 'celebrity', 'eco', 'join'],
  2: [P[1], 'exaggerated', 'normal', 'join'],
  3: [P[2], 'honest', 'cheap', 'join'],
  4: [P[3], 'celebrity', 'eco', 'no'],
  5: [P[1], 'exaggerated', 'normal', 'no'],
});
report('같은 가격 10,000원, 전략만 다름 (담합 4곳)', {
  1: [10000, 'exaggerated', 'cheap', 'join'],
  2: [10000, 'celebrity', 'normal', 'join'],
  3: [10000, 'honest', 'eco', 'join'],
  4: [10000, 'exaggerated', 'eco', 'join'],
  5: [10000, 'honest', 'eco', 'no'],
});
for (const n of [0, 1, 2, 3, 4, 5]) {
  const ch = {};
  TEAM_IDS.forEach((id, i) => { ch[id] = [10000, 'celebrity', 'normal', i < n ? 'join' : 'no']; });
  const g = play(ch);
  const r4 = g.state.rounds[4].results;
  const mem = TEAM_IDS.filter((id, i) => i < n).map((id) => r4[id].revenue);
  const non = TEAM_IDS.filter((id, i) => i >= n).map((id) => r4[id].revenue);
  const avg = (a) => (a.length ? won(a.reduce((x, y) => x + y, 0) / a.length) : '-');
  console.log(`  담합 ${n}곳 참여 → 4라운드 매출 평균: 참여 ${avg(mem).padStart(11)} / 불참 ${avg(non).padStart(11)}  (평소 약 ${won(50 * 1.35 * 10000)})`);
}

// 무작위 게임 N판: 선택별 평균 이윤과 사회점수
const N = Number(process.argv[2]) || 5000;
const stat = {};
const add = (k, v) => { (stat[k] ??= []).push(v); };
const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
let topHasPenalty = 0;
let worstTop2 = 0;
let worstTop1 = 0;
let worstCount = 0;
let scoreSum = 0;
let negative = 0;
const byPenalty = {}; // 기업별 사회점수 감소 기여(감점 합) → 평균 순위
const rnd = (a) => a[Math.floor(Math.random() * a.length)];
for (let i = 0; i < N; i++) {
  const ch = {};
  for (const id of TEAM_IDS) ch[id] = [rnd(P), rnd(['celebrity', 'exaggerated', 'honest']), rnd(['eco', 'normal', 'cheap']), rnd(['join', 'no'])];
  const g = play(ch);
  const rank = Object.fromEntries(g.state.standings.map((x) => [x.teamId, x.rank]));
  // 기업별 감점 기여: 과장·생산은 본인 몫, 담합은 참여 기업이 나눠 가짐
  const penalty = Object.fromEntries(TEAM_IDS.map((id) => [id, 0]));
  for (const e of g.state.socialEvents) for (const id of e.teamIds) penalty[id] += e.delta / e.teamIds.length;
  for (const id of TEAM_IDS) {
    const c = g.state.teams[id].choices;
    const profit = g.state.teams[id].cash - C.STARTING_CASH;
    add(`가격 ${won(c.price)}`, profit);
    add(`광고 ${optionLabel(2, c.ad)}`, profit);
    add(`생산 ${optionLabel(3, c.production)}`, profit);
    add(`담합 ${c.collusion === 'join' ? '참여' : '불참'}`, profit);
    (byPenalty[Math.round(-penalty[id])] ??= []).push(rank[id]);
  }
  // 이 판에서 사회점수를 가장 많이 깎은 기업(동률이면 모두)이 이윤 상위권(1·2위)에 드는가
  const worst = Math.min(...TEAM_IDS.map((id) => penalty[id]));
  if (worst < 0) {
    for (const id of TEAM_IDS.filter((x) => penalty[x] === worst)) {
      worstCount++;
      if (rank[id] <= 2) worstTop2++;
      if (rank[id] === 1) worstTop1++;
    }
  }
  const top = g.state.standings[0].teamId;
  if (g.state.socialEvents.some((e) => e.teamIds.includes(top))) topHasPenalty++;
  scoreSum += g.socialScore();
  if (g.socialScore() < 0) negative++;
}
console.log(`\n■ 무작위 ${N}판 — 선택별 평균 최종 이윤 (각 기업이 모든 선택을 무작위로 고름)`);
const ORDER = ['가격', '광고', '생산', '담합'];
const entries = Object.entries(stat).sort(([a], [b]) => ORDER.indexOf(a.split(' ')[0]) - ORDER.indexOf(b.split(' ')[0]) || avg(stat[b]) - avg(stat[a]));
for (const [k, v] of entries) console.log(`  ${k.padEnd(14)} ${won(avg(v)).padStart(12)}  (${v.length}건)`);
console.log('\n■ 사회점수 감소 기여(기업 1곳 기준) → 평균 최종 순위');
for (const k of Object.keys(byPenalty).map(Number).sort((a, b) => a - b)) {
  console.log(`  감점 ${String(-k).padStart(4)} : 평균 ${avg(byPenalty[k]).toFixed(2)}위  (${byPenalty[k].length}건)`);
}
console.log(`\n  사회점수를 가장 많이 깎은 기업 → 1위 ${((worstTop1 / worstCount) * 100).toFixed(1)}% · 1~2위(상위권) ${((worstTop2 / worstCount) * 100).toFixed(1)}%  (무작위 기대값 20% · 40%)`);
console.log(`  1위 기업이 사회점수 감소에 기여한 비율: ${((topHasPenalty / N) * 100).toFixed(1)}%`);
console.log(`  평균 사회점수: ${(scoreSum / N).toFixed(1)} / 음수로 끝난 비율: ${((negative / N) * 100).toFixed(1)}%`);

// 같은 가격·같은 담합 선택에서 광고/생산만 바꿨을 때 (순수 효과 비교)
console.log('\n■ 가격 10,000원 · 담합 불참 고정, 광고×생산만 다를 때 최종 이윤 (5기업 동일 조건, 시장변동 평균)');
for (const ad of ['exaggerated', 'celebrity', 'honest']) {
  const row = ['cheap', 'normal', 'eco'].map((pr) => {
    const vals = [];
    for (let i = 0; i < 200; i++) {
      const ch = {};
      TEAM_IDS.forEach((id) => { ch[id] = [10000, ad, pr, 'no']; });
      const g = play(ch);
      vals.push(avg(TEAM_IDS.map((id) => g.state.teams[id].cash - C.STARTING_CASH)));
    }
    return `${optionLabel(3, pr)} ${won(avg(vals)).padStart(11)}`;
  });
  console.log(`  ${optionLabel(2, ad).padEnd(6)} | ${row.join(' | ')}`);
}
