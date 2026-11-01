-- 009: 운영 도구 (관리자 페이지 admin.html 용)
--   1) 1:1 문의: inquiries + inquiry_messages (플레이어 ↔ 관리자 대화, 번역문 함께 저장)
--   2) 판 기록: run_logs (플레이어 통계)
--   3) 클라이언트 오류: client_errors
--   4) 관리자 조치 기록: admin_actions (코인 지급 등)
--   모든 테이블은 RLS 로 직접 접근을 막고, 아래 security definer 함수로만 읽고 씀.
--   관리자 함수는 player_data.is_admin = true 인 계정만 실행 가능.

-- ---------------------------------------------------------------------
-- 공통: 관리자 확인
-- ---------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select p.is_admin from player_data p where p.user_id = auth.uid()), false);
$$;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

create or replace function public._require_admin()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;
end;
$$;
revoke all on function public._require_admin() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 1) 1:1 문의
-- ---------------------------------------------------------------------
create table if not exists public.inquiries (
  id           bigserial primary key,
  user_id      uuid not null references auth.users (id) on delete cascade,
  nickname     text not null default '',
  country_code text,
  lang         text not null default 'en',
  category     text not null default 'other' check (category in ('payment', 'bug', 'account', 'suggestion', 'other')),
  subject      text not null default '' check (char_length(subject) <= 120),
  status       text not null default 'open' check (status in ('open', 'answered', 'closed')),
  app_build    text not null default '',
  device       text not null default '',
  user_unread  boolean not null default false, -- 관리자 답변을 아직 안 봄
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists inquiries_status_idx on public.inquiries (status, updated_at desc);
create index if not exists inquiries_user_idx on public.inquiries (user_id, updated_at desc);
alter table public.inquiries enable row level security;

create table if not exists public.inquiry_messages (
  id              bigserial primary key,
  inquiry_id      bigint not null references public.inquiries (id) on delete cascade,
  sender          text not null check (sender in ('user', 'admin')),
  body            text not null check (char_length(body) between 1 and 4000),
  lang            text not null default '',
  translated      text not null default '' check (char_length(translated) <= 4000), -- 관리자 답변: 플레이어 언어 번역문
  translated_lang text not null default '',
  created_at      timestamptz not null default now()
);
create index if not exists inquiry_messages_idx on public.inquiry_messages (inquiry_id, id);
alter table public.inquiry_messages enable row level security;

-- 플레이어: 새 문의 (하루 5건 제한)
create or replace function public.submit_inquiry(
  p_category text, p_subject text, p_message text, p_lang text, p_app_build text, p_device text
)
returns bigint
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  uid uuid := auth.uid();
  nid bigint;
  nick text;
  cc text;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if coalesce(char_length(trim(p_message)), 0) < 2 or char_length(p_message) > 2000 then raise exception 'invalid message'; end if;
  if (select count(*) from inquiries where user_id = uid and created_at > now() - interval '1 day') >= 5 then
    raise exception 'too many inquiries today';
  end if;
  select coalesce(l.nickname, u.raw_user_meta_data ->> 'nickname', split_part(u.email, '@', 1)), p.country_code
    into nick, cc
    from auth.users u left join leaderboard l on l.user_id = u.id left join player_data p on p.user_id = u.id
   where u.id = uid;
  insert into inquiries (user_id, nickname, country_code, lang, category, subject, app_build, device)
  values (uid, left(coalesce(nick, ''), 32), cc, left(coalesce(p_lang, 'en'), 8),
          case when p_category in ('payment', 'bug', 'account', 'suggestion', 'other') then p_category else 'other' end,
          left(coalesce(p_subject, ''), 120), left(coalesce(p_app_build, ''), 40), left(coalesce(p_device, ''), 160))
  returning id into nid;
  insert into inquiry_messages (inquiry_id, sender, body, lang) values (nid, 'user', p_message, left(coalesce(p_lang, ''), 8));
  return nid;
end;
$$;
revoke all on function public.submit_inquiry(text, text, text, text, text, text) from public, anon;
grant execute on function public.submit_inquiry(text, text, text, text, text, text) to authenticated;

-- 플레이어: 추가 메시지 (닫힌 문의에는 불가)
create or replace function public.reply_my_inquiry(p_id bigint, p_message text, p_lang text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if coalesce(char_length(trim(p_message)), 0) < 1 or char_length(p_message) > 2000 then raise exception 'invalid message'; end if;
  if not exists (select 1 from inquiries where id = p_id and user_id = uid and status <> 'closed') then
    raise exception 'not found';
  end if;
  if (select count(*) from inquiry_messages m where m.inquiry_id = p_id and m.sender = 'user' and m.created_at > now() - interval '1 hour') >= 10 then
    raise exception 'too many messages';
  end if;
  insert into inquiry_messages (inquiry_id, sender, body, lang) values (p_id, 'user', p_message, left(coalesce(p_lang, ''), 8));
  update inquiries set status = 'open', updated_at = now() where id = p_id;
end;
$$;
revoke all on function public.reply_my_inquiry(bigint, text, text) from public, anon;
grant execute on function public.reply_my_inquiry(bigint, text, text) to authenticated;

-- 플레이어: 내 문의 목록 + 대화 (읽음 처리 포함)
create or replace function public.my_inquiries(p_mark_read boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  res jsonb;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  select coalesce(jsonb_agg(x order by x.updated_at desc), '[]'::jsonb) into res from (
    select i.id, i.category, i.subject, i.status, i.user_unread, i.created_at, i.updated_at,
      (select coalesce(jsonb_agg(jsonb_build_object('sender', m.sender, 'body', m.body, 'translated', m.translated,
                'translated_lang', m.translated_lang, 'created_at', m.created_at) order by m.id), '[]'::jsonb)
         from inquiry_messages m where m.inquiry_id = i.id) as messages
    from inquiries i where i.user_id = uid order by i.updated_at desc limit 30
  ) x;
  if p_mark_read then update inquiries set user_unread = false where user_id = uid and user_unread; end if;
  return res;
end;
$$;
revoke all on function public.my_inquiries(boolean) from public, anon;
grant execute on function public.my_inquiries(boolean) to authenticated;

-- 관리자: 문의 목록
create or replace function public.admin_list_inquiries(p_status text default null, p_limit int default 50, p_offset int default 0)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare res jsonb;
begin
  perform public._require_admin();
  select coalesce(jsonb_agg(x), '[]'::jsonb) into res from (
    select i.id, i.user_id, i.nickname, i.country_code, i.lang, i.category, i.subject, i.status, i.created_at, i.updated_at,
      (select m.body from inquiry_messages m where m.inquiry_id = i.id order by m.id desc limit 1) as last_message,
      (select m.sender from inquiry_messages m where m.inquiry_id = i.id order by m.id desc limit 1) as last_sender,
      (select count(*) from inquiry_messages m where m.inquiry_id = i.id) as message_count
    from inquiries i
    where p_status is null or i.status = p_status
    order by (i.status = 'open') desc, i.updated_at desc
    limit least(greatest(p_limit, 1), 200) offset greatest(p_offset, 0)
  ) x;
  return res;
end;
$$;
revoke all on function public.admin_list_inquiries(text, int, int) from public, anon;
grant execute on function public.admin_list_inquiries(text, int, int) to authenticated;

-- 관리자: 문의 상세
create or replace function public.admin_get_inquiry(p_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare res jsonb;
begin
  perform public._require_admin();
  select to_jsonb(i) || jsonb_build_object('messages',
    (select coalesce(jsonb_agg(to_jsonb(m) order by m.id), '[]'::jsonb) from inquiry_messages m where m.inquiry_id = i.id))
    into res from inquiries i where i.id = p_id;
  return res;
end;
$$;
revoke all on function public.admin_get_inquiry(bigint) from public, anon;
grant execute on function public.admin_get_inquiry(bigint) to authenticated;

-- 관리자: 답변 (원문 + 플레이어 언어 번역문). p_close 면 종료 처리
create or replace function public.admin_reply_inquiry(
  p_id bigint, p_body text, p_translated text, p_translated_lang text, p_close boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  if coalesce(char_length(trim(p_body)), 0) < 1 or char_length(p_body) > 4000 then raise exception 'invalid message'; end if;
  insert into inquiry_messages (inquiry_id, sender, body, lang, translated, translated_lang)
  values (p_id, 'admin', p_body, 'ko', left(coalesce(p_translated, ''), 4000), left(coalesce(p_translated_lang, ''), 8));
  update inquiries set status = case when p_close then 'closed' else 'answered' end, user_unread = true, updated_at = now() where id = p_id;
end;
$$;
revoke all on function public.admin_reply_inquiry(bigint, text, text, text, boolean) from public, anon;
grant execute on function public.admin_reply_inquiry(bigint, text, text, text, boolean) to authenticated;

create or replace function public.admin_set_inquiry_status(p_id bigint, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  if p_status not in ('open', 'answered', 'closed') then raise exception 'invalid status'; end if;
  update inquiries set status = p_status, updated_at = now() where id = p_id;
end;
$$;
revoke all on function public.admin_set_inquiry_status(bigint, text) from public, anon;
grant execute on function public.admin_set_inquiry_status(bigint, text) to authenticated;

-- ---------------------------------------------------------------------
-- 2) 판 기록 (통계)
-- ---------------------------------------------------------------------
create table if not exists public.run_logs (
  id           bigserial primary key,
  user_id      uuid references auth.users (id) on delete cascade, -- 게스트는 null
  country_code text,
  theme        text not null default '',
  dist         integer not null default 0,
  score        integer not null default 0,
  coins        integer not null default 0,
  duration_s   integer not null default 0,
  bike         text not null default '',
  app_build    text not null default '',
  created_at   timestamptz not null default now()
);
create index if not exists run_logs_time_idx on public.run_logs (created_at desc);
create index if not exists run_logs_user_idx on public.run_logs (user_id, created_at desc);
alter table public.run_logs enable row level security;

create or replace function public.log_run(
  p_dist int, p_score int, p_coins int, p_duration int, p_bike text, p_theme text, p_country text, p_app_build text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  cc text;
begin
  if p_dist < 0 or p_dist > 1000000 or p_score < 0 or p_score > 10000000 or p_coins < 0 or p_coins > 1000000
     or p_duration < 0 or p_duration > 86400 then
    return; -- 이상값은 조용히 무시
  end if;
  if uid is not null then
    -- 같은 계정 2초 안 연속 기록 무시
    if exists (select 1 from run_logs where user_id = uid and created_at > now() - interval '2 seconds') then return; end if;
    select p.country_code into cc from player_data p where p.user_id = uid;
  end if;
  insert into run_logs (user_id, country_code, theme, dist, score, coins, duration_s, bike, app_build)
  values (uid, coalesce(cc, case when p_country ~ '^[A-Z]{2}$' then p_country end), left(coalesce(p_theme, ''), 8),
          p_dist, p_score, p_coins, p_duration, left(coalesce(p_bike, ''), 24), left(coalesce(p_app_build, ''), 40));
end;
$$;
revoke all on function public.log_run(int, int, int, int, text, text, text, text) from public;
grant execute on function public.log_run(int, int, int, int, text, text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 3) 클라이언트 오류
-- ---------------------------------------------------------------------
create table if not exists public.client_errors (
  id         bigserial primary key,
  user_id    uuid references auth.users (id) on delete set null,
  message    text not null,
  stack      text not null default '',
  source     text not null default '',
  app_build  text not null default '',
  device     text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists client_errors_time_idx on public.client_errors (created_at desc);
alter table public.client_errors enable row level security;

create or replace function public.log_client_error(p_message text, p_stack text, p_source text, p_app_build text, p_device text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(char_length(p_message), 0) = 0 then return; end if;
  -- 전역 폭주 방지: 최근 1분 오류가 300건 넘으면 버림
  if (select count(*) from client_errors where created_at > now() - interval '1 minute') > 300 then return; end if;
  insert into client_errors (user_id, message, stack, source, app_build, device)
  values (auth.uid(), left(p_message, 500), left(coalesce(p_stack, ''), 3000), left(coalesce(p_source, ''), 300),
          left(coalesce(p_app_build, ''), 40), left(coalesce(p_device, ''), 160));
end;
$$;
revoke all on function public.log_client_error(text, text, text, text, text) from public;
grant execute on function public.log_client_error(text, text, text, text, text) to anon, authenticated;

-- 관리자: 오류 (메시지별 묶음)
create or replace function public.admin_list_errors(p_days int default 7, p_limit int default 100)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare res jsonb;
begin
  perform public._require_admin();
  select coalesce(jsonb_agg(x order by x.last_seen desc), '[]'::jsonb) into res from (
    select e.message, count(*) as count, count(distinct e.user_id) as users, max(e.created_at) as last_seen,
           min(e.created_at) as first_seen,
           (array_agg(e.stack order by e.created_at desc))[1] as stack,
           (array_agg(e.source order by e.created_at desc))[1] as source,
           (array_agg(e.app_build order by e.created_at desc))[1] as app_build,
           (array_agg(e.device order by e.created_at desc))[1] as device
      from client_errors e
     where e.created_at > now() - make_interval(days => least(greatest(p_days, 1), 90))
     group by e.message
     order by max(e.created_at) desc
     limit least(greatest(p_limit, 1), 500)
  ) x;
  return res;
end;
$$;
revoke all on function public.admin_list_errors(int, int) from public, anon;
grant execute on function public.admin_list_errors(int, int) to authenticated;

-- ---------------------------------------------------------------------
-- 4) 관리자 통계 · 순위 · 플레이어 검색/상세 · 코인 지급
-- ---------------------------------------------------------------------
create table if not exists public.admin_actions (
  id         bigserial primary key,
  admin_id   uuid,
  target_id  uuid,
  action     text not null,
  detail     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.admin_actions enable row level security;

create or replace function public.admin_stats(p_days int default 14)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  d int := least(greatest(p_days, 1), 90);
  since timestamptz := date_trunc('day', now()) - make_interval(days => d - 1);
  res jsonb;
begin
  perform public._require_admin();
  select jsonb_build_object(
    'players_total', (select count(*) from auth.users),
    'players_new', (select count(*) from auth.users where created_at >= since),
    'runs_total', (select count(*) from run_logs where created_at >= since),
    'active_users', (select count(distinct user_id) from run_logs where created_at >= since and user_id is not null),
    'guest_runs', (select count(*) from run_logs where created_at >= since and user_id is null),
    'avg_dist', (select coalesce(round(avg(dist)), 0) from run_logs where created_at >= since),
    'avg_coins', (select coalesce(round(avg(coins)), 0) from run_logs where created_at >= since),
    'avg_duration', (select coalesce(round(avg(duration_s)), 0) from run_logs where created_at >= since),
    'open_inquiries', (select count(*) from inquiries where status = 'open'),
    'errors', (select count(*) from client_errors where created_at >= since),
    'revenue_coins', (select coalesce(sum(coins), 0) from purchases where created_at >= since),
    'purchases', (select count(*) from purchases where created_at >= since),
    'daily', (select coalesce(jsonb_agg(x order by x.day), '[]'::jsonb) from (
        select g.day::date as day,
          (select count(*) from auth.users u where u.created_at >= g.day and u.created_at < g.day + interval '1 day') as new_players,
          (select count(distinct r.user_id) from run_logs r where r.created_at >= g.day and r.created_at < g.day + interval '1 day' and r.user_id is not null) as dau,
          (select count(*) from run_logs r where r.created_at >= g.day and r.created_at < g.day + interval '1 day') as runs,
          (select count(*) from client_errors e where e.created_at >= g.day and e.created_at < g.day + interval '1 day') as errors
        from generate_series(since, date_trunc('day', now()), interval '1 day') as g(day)) x),
    'countries', (select coalesce(jsonb_agg(x order by x.players desc), '[]'::jsonb) from (
        select coalesce(p.country_code, '--') as country, count(*) as players,
               (select count(*) from run_logs r where r.country_code = p.country_code and r.created_at >= since) as runs
          from player_data p where not p.is_admin group by p.country_code) x)
  ) into res;
  return res;
end;
$$;
revoke all on function public.admin_stats(int) from public, anon;
grant execute on function public.admin_stats(int) to authenticated;

-- 관리자: 순위 (국가 지정 시 그 나라, 아니면 전 세계)
create or replace function public.admin_rankings(p_country text default null, p_limit int default 100, p_offset int default 0)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare res jsonb;
begin
  perform public._require_admin();
  select coalesce(jsonb_agg(x order by x.rank), '[]'::jsonb) into res from (
    select rank() over (order by l.score desc, l.best_at asc) as rank,
           l.user_id, l.nickname, l.score, l.dist, l.country_code, l.bike, l.best_at, l.updated_at
      from leaderboard l
     where (p_country is null or l.country_code = p_country)
       and not exists (select 1 from player_data p where p.user_id = l.user_id and p.is_admin)
     order by l.score desc, l.best_at asc
     limit least(greatest(p_limit, 1), 500) offset greatest(p_offset, 0)
  ) x;
  return res;
end;
$$;
revoke all on function public.admin_rankings(text, int, int) from public, anon;
grant execute on function public.admin_rankings(text, int, int) to authenticated;

-- 관리자: 플레이어 검색 (닉네임·아이디 일부, 또는 사용자 UUID)
create or replace function public.admin_search_players(p_q text, p_country text default null, p_limit int default 50)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  q text := lower(trim(coalesce(p_q, '')));
  res jsonb;
begin
  perform public._require_admin();
  select coalesce(jsonb_agg(x), '[]'::jsonb) into res from (
    select u.id as user_id, split_part(u.email, '@', 1) as login_id,
           coalesce(l.nickname, u.raw_user_meta_data ->> 'nickname', split_part(u.email, '@', 1)) as nickname,
           p.country_code, coalesce(l.score, 0) as score, coalesce(l.dist, 0) as dist,
           coalesce((p.data ->> 'coins')::bigint, 0) as coins, p.is_admin, u.created_at, u.last_sign_in_at
      from auth.users u
      left join leaderboard l on l.user_id = u.id
      left join player_data p on p.user_id = u.id
     where (q = '' or lower(split_part(u.email, '@', 1)) like '%' || q || '%' or lower(coalesce(l.nickname, '')) like '%' || q || '%'
            or u.id::text = q)
       and (p_country is null or p.country_code = p_country)
     order by coalesce(l.score, 0) desc, u.created_at desc
     limit least(greatest(p_limit, 1), 200)
  ) x;
  return res;
end;
$$;
revoke all on function public.admin_search_players(text, text, int) from public, anon;
grant execute on function public.admin_search_players(text, text, int) to authenticated;

-- 관리자: 플레이어 상세
create or replace function public.admin_player_detail(p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  res jsonb;
  sc int;
  cc text;
begin
  perform public._require_admin();
  select l.score, l.country_code into sc, cc from leaderboard l where l.user_id = p_user;
  select jsonb_build_object(
    'user_id', u.id, 'login_id', split_part(u.email, '@', 1),
    'nickname', coalesce(l.nickname, u.raw_user_meta_data ->> 'nickname', split_part(u.email, '@', 1)),
    'created_at', u.created_at, 'last_sign_in_at', u.last_sign_in_at,
    'country_code', p.country_code, 'is_admin', coalesce(p.is_admin, false),
    'pending_coins', coalesce(p.pending_coins, 0), 'purchased_coins', coalesce(p.purchased_coins, 0),
    'save_updated_at', p.updated_at,
    'data', coalesce(p.data, '{}'::jsonb) - 'settings' - 'missions',
    'leaderboard', case when l.user_id is null then null else to_jsonb(l) - 'user_id' end,
    'rank_global', case when sc is null then null else (select count(*) + 1 from leaderboard x where x.score > sc
                     and not exists (select 1 from player_data a where a.user_id = x.user_id and a.is_admin)) end,
    'rank_country', case when sc is null then null else (select count(*) + 1 from leaderboard x where x.score > sc and x.country_code = cc
                     and not exists (select 1 from player_data a where a.user_id = x.user_id and a.is_admin)) end,
    'runs', (select coalesce(jsonb_agg(r order by r.created_at desc), '[]'::jsonb) from (
               select dist, score, coins, duration_s, bike, theme, created_at from run_logs where user_id = p_user
               order by created_at desc limit 30) r),
    'run_count', (select count(*) from run_logs where user_id = p_user),
    'purchases', (select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb) from (
               select product_id, coins, platform, created_at from purchases where user_id = p_user order by created_at desc limit 30) x),
    'inquiries', (select coalesce(jsonb_agg(x order by x.updated_at desc), '[]'::jsonb) from (
               select id, category, subject, status, updated_at from inquiries where user_id = p_user order by updated_at desc limit 30) x),
    'admin_actions', (select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb) from (
               select action, detail, created_at from admin_actions where target_id = p_user order by created_at desc limit 30) x)
  ) into res
  from auth.users u
  left join leaderboard l on l.user_id = u.id
  left join player_data p on p.user_id = u.id
  where u.id = p_user;
  return res;
end;
$$;
revoke all on function public.admin_player_detail(uuid) from public, anon;
grant execute on function public.admin_player_detail(uuid) to authenticated;

-- 관리자: 코인 지급 (문의 보상 등). pending_coins 로 넣으면 게임이 다음 접속 때 받아 감. 기록은 admin_actions
create or replace function public.admin_grant_coins(p_user uuid, p_amount int, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  if p_amount is null or p_amount < 1 or p_amount > 1000000 then raise exception 'invalid amount'; end if;
  insert into player_data (user_id, pending_coins) values (p_user, p_amount)
  on conflict (user_id) do update set pending_coins = player_data.pending_coins + excluded.pending_coins;
  insert into admin_actions (admin_id, target_id, action, detail)
  values (auth.uid(), p_user, 'grant_coins', jsonb_build_object('amount', p_amount, 'reason', left(coalesce(p_reason, ''), 200)));
end;
$$;
revoke all on function public.admin_grant_coins(uuid, int, text) from public, anon;
grant execute on function public.admin_grant_coins(uuid, int, text) to authenticated;
