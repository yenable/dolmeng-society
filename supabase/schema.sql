-- =====================================================================
--  돌멩민국 슬랑이 시장 — Supabase 스키마
--  Supabase 대시보드 → SQL Editor → New query 에 이 파일 전체를 붙여 넣고 Run.
--  여러 번 실행해도 안전합니다. (이미 있는 테이블·데이터는 그대로 둠)
--
--  구조 요약
--   · game_sessions.state  : 게임 엔진 상태 전체(JSON). 진짜 기준(source of truth).
--   · teams / responses / round_results / social_events / reflections
--                          : 같은 트랜잭션에서 함께 기록되는 정규화 테이블(기록·확인용, 중복 방지 제약).
--   · session_pulse        : 학생/TV 브라우저가 Realtime 으로 구독하는 '변경 신호'(민감 정보 없음).
--   · 모든 쓰기는 Vercel 서버 함수가 service_role 키로 slangi_save() 를 호출해서만 일어납니다.
--     slangi_save() 는 revision 비교(낙관적 잠금)로 동시에 들어온 요청 중 하나만 반영합니다.
-- =====================================================================

-- ── 테이블 ──────────────────────────────────────────────────────────
create table if not exists public.game_sessions (
  id             uuid primary key,
  slot           text        not null default 'main',
  status         text        not null default 'active' check (status in ('active', 'archived')),
  current_step   text        not null default 'INTRO',
  current_round  int,
  display_slide  int         not null default 0,
  social_score   int         not null default 100,
  market_seed    bigint,
  revision       bigint      not null default 1,
  state          jsonb       not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  archived_at    timestamptz
);
-- 활성 게임 세션은 슬롯당 하나만
create unique index if not exists game_sessions_one_active on public.game_sessions (slot) where status = 'active';

create table if not exists public.teams (
  id                bigint generated always as identity primary key,
  session_id        uuid    not null references public.game_sessions (id) on delete cascade,
  team_no           int     not null check (team_no between 1 and 5),
  name              text    not null,
  color             text    not null,
  claim_token_hash  text,                 -- 학생 재접속 토큰의 SHA-256 (원문은 저장하지 않음)
  claimed_at        timestamptz,
  is_virtual        boolean not null default false,
  cash              bigint  not null,
  revenue_total     bigint  not null default 0,
  units_total       int     not null default 0,
  profit            bigint  not null default 0,
  rank              int,
  price_choice      text,
  ad_choice         text,
  production_choice text,
  collusion_choice  text,
  updated_at        timestamptz not null default now(),
  unique (session_id, team_no)
);
create index if not exists teams_token_idx on public.teams (session_id, claim_token_hash);

create table if not exists public.responses (
  id           bigint generated always as identity primary key,
  session_id   uuid    not null references public.game_sessions (id) on delete cascade,
  team_id      bigint  not null references public.teams (id) on delete cascade,
  team_no      int     not null,
  round        int     not null check (round between 1 and 4),
  choice       text    not null,
  reason       text    not null,
  prediction   text,
  cost         bigint  not null default 0,
  by_admin     boolean not null default false,
  by_default   boolean not null default false,
  submitted_at timestamptz not null default now(),
  unique (session_id, team_id, round)
);

create table if not exists public.round_results (
  id               bigint generated always as identity primary key,
  session_id       uuid    not null references public.game_sessions (id) on delete cascade,
  team_id          bigint  not null references public.teams (id) on delete cascade,
  team_no          int     not null,
  round            int     not null check (round between 1 and 4),
  units            int     not null,
  price            int     not null,
  revenue          bigint  not null,
  spent            bigint  not null,
  cash_before      bigint  not null,
  cash_after       bigint  not null,
  profit_before    bigint  not null,
  profit_after     bigint  not null,
  rank_before      int,
  rank_after       int     not null,
  collusion_member boolean not null default false,
  computed_at      timestamptz not null default now(),
  unique (session_id, team_id, round)
);

create table if not exists public.social_events (
  id         bigint generated always as identity primary key,
  session_id uuid   not null references public.game_sessions (id) on delete cascade,
  team_id    bigint references public.teams (id) on delete cascade, -- 한 기업 원인일 때
  team_nos   int[]  not null,                                       -- 원인 기업들 (담합은 여러 곳)
  round      int    not null,
  category   text   not null check (category in ('consumer', 'environment', 'fairness')),
  source     text   not null,   -- exaggerated / normal / cheap / collusion …
  delta      int    not null,
  label      text   not null,   -- 과장 광고, 비용 절감 생산, 담합 참여 3 / 5 기업 …
  sequence   int    not null,
  created_at timestamptz not null default now(),
  unique (session_id, sequence)
);

create table if not exists public.reflections (
  id           bigint generated always as identity primary key,
  session_id   uuid    not null references public.game_sessions (id) on delete cascade,
  team_id      bigint  not null references public.teams (id) on delete cascade,
  team_no      int     not null,
  target       text    not null,
  old_choice   text,
  new_choice   text    not null,
  reason       text    not null,
  by_admin     boolean not null default false,
  submitted_at timestamptz not null default now(),
  unique (session_id, team_id)
);

-- 학생 노트북 접속 표시(하트비트). 게임 상태와 분리되어 revision 을 올리지 않음
create table if not exists public.team_presence (
  session_id   uuid not null references public.game_sessions (id) on delete cascade,
  team_no      int  not null,
  client_id    text not null,
  last_seen_at timestamptz not null default now(),
  primary key (session_id, team_no, client_id)
);

-- Realtime 변경 신호 (브라우저가 구독). 숨은 정보 없음: 세션 id, revision, 현재 단계만
create table if not exists public.session_pulse (
  slot       text primary key,
  session_id uuid   not null,
  revision   bigint not null,
  step_id    text   not null,
  updated_at timestamptz not null default now()
);

-- ── 권한 / RLS ──────────────────────────────────────────────────────
-- 모든 테이블 RLS 켬. 정책이 없으면 anon(브라우저)은 아무것도 읽고 쓸 수 없음.
-- service_role(서버 전용 키)은 RLS 를 우회하므로 서버 함수만 데이터에 접근 가능.
alter table public.game_sessions enable row level security;
alter table public.teams         enable row level security;
alter table public.responses     enable row level security;
alter table public.round_results enable row level security;
alter table public.social_events enable row level security;
alter table public.reflections   enable row level security;
alter table public.team_presence enable row level security;
alter table public.session_pulse enable row level security;

revoke all on public.game_sessions, public.teams, public.responses, public.round_results,
              public.social_events, public.reflections, public.team_presence, public.session_pulse
  from anon, authenticated;

-- 브라우저는 session_pulse 읽기만 (Realtime 구독용)
grant select on public.session_pulse to anon, authenticated;
drop policy if exists "pulse is public" on public.session_pulse;
create policy "pulse is public" on public.session_pulse for select to anon, authenticated using (true);

grant all on public.game_sessions, public.teams, public.responses, public.round_results,
             public.social_events, public.reflections, public.team_presence, public.session_pulse
  to service_role;

-- ── RPC: 상태 읽기 (+ 학생 접속 하트비트) ─────────────────────────────
create or replace function public.slangi_load(p jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_slot     text := coalesce(p->>'slot', 'main');
  v_window   double precision := coalesce((p->>'window_s')::double precision, 20);
  s          record;
  v_team     int;
  v_presence jsonb := '[]'::jsonb;
begin
  select id, revision, state into s
    from game_sessions where slot = v_slot and status = 'active';
  if not found then
    return jsonb_build_object('session', null, 'presence', '[]'::jsonb);
  end if;

  if coalesce(p->>'token_hash', '') <> '' and coalesce(p->>'client_id', '') <> '' then
    select team_no into v_team from teams
      where session_id = s.id and claim_token_hash = p->>'token_hash';
    if v_team is not null then
      insert into team_presence (session_id, team_no, client_id, last_seen_at)
        values (s.id, v_team, left(p->>'client_id', 64), now())
        on conflict (session_id, team_no, client_id) do update set last_seen_at = excluded.last_seen_at;
    end if;
  end if;

  if coalesce((p->>'presence')::boolean, false) then
    select coalesce(jsonb_agg(jsonb_build_object('team_no', team_no, 'clients', n)), '[]'::jsonb) into v_presence
      from (select team_no, count(*) as n from team_presence
             where session_id = s.id and last_seen_at > now() - make_interval(secs => v_window)
             group by team_no) x;
  end if;

  return jsonb_build_object(
    'session', jsonb_build_object('id', s.id, 'revision', s.revision, 'state', s.state),
    'presence', v_presence);
end;
$$;

-- ── RPC: 상태 저장 (한 트랜잭션, revision 비교로 정확히 한 번) ──────────
--  p.expected_session_id / p.expected_revision 이 현재 활성 세션과 다르면 REVISION_CONFLICT.
--  p.session_id 가 expected 와 다르면 새 세션(전체 초기화): 기존 세션은 archived 로 보존.
create or replace function public.slangi_save(p jsonb)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_slot     text   := coalesce(p->>'slot', 'main');
  v_sid      uuid   := (p->>'session_id')::uuid;
  v_exp_sid  uuid   := nullif(p->>'expected_session_id', '')::uuid;
  v_exp_rev  bigint := (p->>'expected_revision')::bigint;
  v_rev      bigint;
  m          jsonb  := coalesce(p->'meta', '{}'::jsonb);
begin
  if v_sid is null or p->'state' is null then
    raise exception 'BAD_PAYLOAD';
  end if;

  if v_exp_sid is null or v_sid <> v_exp_sid then
    -- 새 세션 만들기 (최초 생성 또는 전체 초기화)
    if v_exp_sid is null then
      if exists (select 1 from game_sessions where slot = v_slot and status = 'active') then
        raise exception 'REVISION_CONFLICT';
      end if;
    else
      update game_sessions set status = 'archived', archived_at = now(), updated_at = now()
        where id = v_exp_sid and slot = v_slot and status = 'active' and revision = v_exp_rev;
      if not found then
        raise exception 'REVISION_CONFLICT';
      end if;
    end if;
    v_rev := 1;
    insert into game_sessions (id, slot, status, current_step, current_round, display_slide, social_score, market_seed, revision, state)
      values (v_sid, v_slot, 'active', coalesce(m->>'current_step', 'INTRO'), (m->>'current_round')::int,
              coalesce((m->>'display_slide')::int, 0), coalesce((m->>'social_score')::int, 100),
              (m->>'market_seed')::bigint, v_rev, p->'state');
  else
    update game_sessions
       set state = p->'state', revision = revision + 1, updated_at = now(),
           current_step = coalesce(m->>'current_step', current_step),
           current_round = (m->>'current_round')::int,
           display_slide = coalesce((m->>'display_slide')::int, 0),
           social_score = coalesce((m->>'social_score')::int, social_score),
           market_seed = coalesce((m->>'market_seed')::bigint, market_seed)
     where id = v_sid and slot = v_slot and status = 'active' and revision = v_exp_rev
     returning revision into v_rev;
    if not found then
      raise exception 'REVISION_CONFLICT';
    end if;
  end if;

  -- teams
  insert into teams (session_id, team_no, name, color, claim_token_hash, claimed_at, is_virtual, cash, revenue_total,
                     units_total, profit, rank, price_choice, ad_choice, production_choice, collusion_choice, updated_at)
  select v_sid, x.team_no, x.name, x.color, x.claim_token_hash, x.claimed_at, coalesce(x.is_virtual, false), x.cash,
         x.revenue_total, x.units_total, x.profit, x.rank, x.price_choice, x.ad_choice, x.production_choice,
         x.collusion_choice, now()
    from jsonb_to_recordset(coalesce(p->'teams', '[]'::jsonb)) as x(
      team_no int, name text, color text, claim_token_hash text, claimed_at timestamptz, is_virtual boolean, cash bigint,
      revenue_total bigint, units_total int, profit bigint, rank int, price_choice text, ad_choice text,
      production_choice text, collusion_choice text)
  on conflict (session_id, team_no) do update set
    name = excluded.name, color = excluded.color, claim_token_hash = excluded.claim_token_hash,
    claimed_at = excluded.claimed_at, is_virtual = excluded.is_virtual, cash = excluded.cash,
    revenue_total = excluded.revenue_total, units_total = excluded.units_total, profit = excluded.profit,
    rank = excluded.rank, price_choice = excluded.price_choice, ad_choice = excluded.ad_choice,
    production_choice = excluded.production_choice, collusion_choice = excluded.collusion_choice, updated_at = now();

  -- responses (제출 초기화된 것은 삭제)
  delete from responses r
   where r.session_id = v_sid
     and not exists (select 1 from jsonb_to_recordset(coalesce(p->'responses', '[]'::jsonb)) as x(team_no int, round int)
                      where x.team_no = r.team_no and x.round = r.round);
  insert into responses (session_id, team_id, team_no, round, choice, reason, prediction, cost, by_admin, by_default, submitted_at)
  select v_sid, t.id, x.team_no, x.round, x.choice, x.reason, x.prediction, coalesce(x.cost, 0),
         coalesce(x.by_admin, false), coalesce(x.by_default, false), coalesce(x.submitted_at, now())
    from jsonb_to_recordset(coalesce(p->'responses', '[]'::jsonb)) as x(
      team_no int, round int, choice text, reason text, prediction text, cost bigint, by_admin boolean,
      by_default boolean, submitted_at timestamptz)
    join teams t on t.session_id = v_sid and t.team_no = x.team_no
  on conflict (session_id, team_id, round) do update set
    choice = excluded.choice, reason = excluded.reason, prediction = excluded.prediction, cost = excluded.cost,
    by_admin = excluded.by_admin, by_default = excluded.by_default, submitted_at = excluded.submitted_at;

  -- round_results: 한 번 기록된 결과는 절대 바뀌거나 사라지지 않음 (돈 중복 지급 방지 이중 안전장치)
  if exists (
    select 1
      from jsonb_to_recordset(coalesce(p->'round_results', '[]'::jsonb)) as x(team_no int, round int, cash_after bigint, revenue bigint)
      join teams t on t.session_id = v_sid and t.team_no = x.team_no
      join round_results rr on rr.session_id = v_sid and rr.team_id = t.id and rr.round = x.round
     where rr.cash_after <> x.cash_after or rr.revenue <> x.revenue) then
    raise exception 'ROUND_RESULT_MISMATCH';
  end if;
  if exists (
    select 1 from round_results rr
     where rr.session_id = v_sid
       and not exists (select 1 from jsonb_to_recordset(coalesce(p->'round_results', '[]'::jsonb)) as x(team_no int, round int)
                        where x.team_no = rr.team_no and x.round = rr.round)) then
    raise exception 'ROUND_RESULT_REMOVED';
  end if;
  insert into round_results (session_id, team_id, team_no, round, units, price, revenue, spent, cash_before, cash_after,
                             profit_before, profit_after, rank_before, rank_after, collusion_member, computed_at)
  select v_sid, t.id, x.team_no, x.round, x.units, x.price, x.revenue, x.spent, x.cash_before, x.cash_after,
         x.profit_before, x.profit_after, x.rank_before, x.rank_after, coalesce(x.collusion_member, false),
         coalesce(x.computed_at, now())
    from jsonb_to_recordset(coalesce(p->'round_results', '[]'::jsonb)) as x(
      team_no int, round int, units int, price int, revenue bigint, spent bigint, cash_before bigint, cash_after bigint,
      profit_before bigint, profit_after bigint, rank_before int, rank_after int, collusion_member boolean,
      computed_at timestamptz)
    join teams t on t.session_id = v_sid and t.team_no = x.team_no
  on conflict (session_id, team_id, round) do nothing;

  -- social_events
  delete from social_events e
   where e.session_id = v_sid
     and not exists (select 1 from jsonb_to_recordset(coalesce(p->'social_events', '[]'::jsonb)) as x(sequence int)
                      where x.sequence = e.sequence);
  insert into social_events (session_id, team_id, team_nos, round, category, source, delta, label, sequence)
  select v_sid, t.id, coalesce(array(select jsonb_array_elements_text(x.team_nos)::int), '{}'), x.round, x.category,
         x.source, x.delta, x.label, x.sequence
    from jsonb_to_recordset(coalesce(p->'social_events', '[]'::jsonb)) as x(
      team_no int, team_nos jsonb, round int, category text, source text, delta int, label text, sequence int)
    left join teams t on t.session_id = v_sid and t.team_no = x.team_no
  on conflict (session_id, sequence) do update set
    team_id = excluded.team_id, team_nos = excluded.team_nos, round = excluded.round, category = excluded.category,
    source = excluded.source, delta = excluded.delta, label = excluded.label;

  -- reflections
  delete from reflections f
   where f.session_id = v_sid
     and not exists (select 1 from jsonb_to_recordset(coalesce(p->'reflections', '[]'::jsonb)) as x(team_no int)
                      where x.team_no = f.team_no);
  insert into reflections (session_id, team_id, team_no, target, old_choice, new_choice, reason, by_admin, submitted_at)
  select v_sid, t.id, x.team_no, x.target, x.old_choice, x.new_choice, x.reason, coalesce(x.by_admin, false),
         coalesce(x.submitted_at, now())
    from jsonb_to_recordset(coalesce(p->'reflections', '[]'::jsonb)) as x(
      team_no int, target text, old_choice text, new_choice text, reason text, by_admin boolean, submitted_at timestamptz)
    join teams t on t.session_id = v_sid and t.team_no = x.team_no
  on conflict (session_id, team_id) do update set
    target = excluded.target, old_choice = excluded.old_choice, new_choice = excluded.new_choice,
    reason = excluded.reason, by_admin = excluded.by_admin, submitted_at = excluded.submitted_at;

  -- 변경 신호 → Realtime 으로 모든 화면에 전달
  insert into session_pulse (slot, session_id, revision, step_id, updated_at)
    values (v_slot, v_sid, v_rev, coalesce(m->>'current_step', 'INTRO'), now())
  on conflict (slot) do update set
    session_id = excluded.session_id, revision = excluded.revision, step_id = excluded.step_id, updated_at = now();

  return jsonb_build_object('session_id', v_sid, 'revision', v_rev);
end;
$$;

-- RPC 는 서버(service_role)만 호출 가능
revoke all on function public.slangi_load(jsonb) from public, anon, authenticated;
revoke all on function public.slangi_save(jsonb) from public, anon, authenticated;
grant execute on function public.slangi_load(jsonb) to service_role;
grant execute on function public.slangi_save(jsonb) to service_role;

-- ── Realtime: session_pulse 변경을 브라우저로 방송 ─────────────────────
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'session_pulse') then
    alter publication supabase_realtime add table public.session_pulse;
  end if;
end;
$$;
