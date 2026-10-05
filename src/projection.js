// 엔진 상태 → Supabase 정규화 테이블 행 (slangi_save 에 함께 전달, 같은 트랜잭션에서 기록)
import { GAME_CONFIG as C } from './config.js';
import { COMPANIES, TEAM_IDS, ROUNDS } from './content.js';

const iso = (ms) => (ms ? new Date(ms).toISOString() : null);
const str = (v) => (v == null ? null : String(v));

export function projectRows(engine) {
  const s = engine.state;
  const rankOf = Object.fromEntries((s.standings ?? []).map((x) => [x.teamId, x.rank]));

  const teams = COMPANIES.map((c) => {
    const t = s.teams[c.id];
    return {
      team_no: c.id,
      name: c.name,
      color: c.color,
      claim_token_hash: t.tokenHash,
      claimed_at: iso(t.claimedAt),
      is_virtual: !!t.virtual,
      cash: t.cash,
      revenue_total: t.revenueTotal,
      units_total: t.unitsTotal,
      profit: t.cash - C.STARTING_CASH,
      rank: rankOf[c.id] ?? null,
      price_choice: str(t.choices.price),
      ad_choice: str(t.choices.ad),
      production_choice: str(t.choices.production),
      collusion_choice: str(t.choices.collusion),
    };
  });

  const responses = [];
  const roundResults = [];
  for (const r of Object.keys(ROUNDS).map(Number)) {
    for (const id of TEAM_IDS) {
      const sub = s.submissions[r]?.[id];
      if (sub) {
        responses.push({
          team_no: id, round: r, choice: String(sub.choice), reason: sub.reason, prediction: sub.prediction ?? null,
          cost: sub.cost || 0, by_admin: !!sub.byAdmin, by_default: !!sub.byDefault, submitted_at: iso(sub.submittedAt),
        });
      }
      const res = s.rounds[r]?.computed ? s.rounds[r].results[id] : null;
      if (res) {
        roundResults.push({
          team_no: id, round: r, units: res.units, price: res.price, revenue: res.revenue, spent: res.spent,
          cash_before: res.cashAfter - res.revenue, cash_after: res.cashAfter,
          profit_before: res.profitBefore, profit_after: res.profitAfter,
          rank_before: res.rankBefore, rank_after: res.rankAfter,
          collusion_member: !!res.member, computed_at: iso(s.rounds[r].computedAt),
        });
      }
    }
  }

  const socialEvents = s.socialEvents.map((e, i) => ({
    team_no: e.teamIds.length === 1 ? e.teamIds[0] : null,
    team_nos: e.teamIds,
    round: e.round,
    category: e.category,
    source: e.cause,
    delta: e.delta,
    label: e.causeLabel,
    sequence: i + 1,
  }));

  const reflections = TEAM_IDS.filter((id) => s.reflections[id]).map((id) => {
    const f = s.reflections[id];
    return {
      team_no: id, target: f.target, old_choice: str(f.from), new_choice: String(f.to), reason: f.reason,
      by_admin: !!f.byAdmin, submitted_at: iso(f.submittedAt),
    };
  });

  return {
    meta: {
      current_step: s.stepId,
      current_round: engine.step.round ?? null,
      display_slide: s.revealIndex,
      social_score: engine.socialScore(),
      market_seed: s.seed,
    },
    teams,
    responses,
    round_results: roundResults,
    social_events: socialEvents,
    reflections,
  };
}
