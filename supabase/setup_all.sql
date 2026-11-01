-- Grub Rider: Supabase 전체 설정 (SQL Editor 에 통째로 붙여넣고 한 번 실행). 여러 번 실행해도 안전합니다.
-- 포함: schema.sql(기본 랭킹) + 004(서버 저장·국가 고정·관리자) + admin 계정 지정 + 005(관리자 국가 변경) + 006(랭킹 외형 동기화) + 007(코인 결제·계정 삭제·점수 검증) + 008(운영 설정: 가격·보상·공지) + 009(1:1 문의·판 기록·오류·관리자 도구) + 010(관리자 권한 강화: 기록·재산 수정, 정지, 작업 기록)

-- ===================== 기본 스키마 (schema.sql) =====================

create table if not exists public.leaderboard (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  nickname   text not null check (char_length(nickname) between 2 and 16),
  score      integer not null default 0 check (score >= 0),
  bike       text not null default 'rookie',
  updated_at timestamptz not null default now()
);

create index if not exists leaderboard_score_idx on public.leaderboard (score desc);

alter table public.leaderboard enable row level security;

drop policy if exists "leaderboard is readable by everyone" on public.leaderboard;
create policy "leaderboard is readable by everyone" on public.leaderboard
  for select using (true);
-- 쓰기는 아래 함수로만 허용 (insert/update 정책 없음)

-- 본인 최고 점수만 갱신
create or replace function public.submit_score(p_score integer, p_bike text, p_nickname text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  uid  uuid := auth.uid();
  best integer;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  if p_score < 0 or p_score > 10000000 then
    raise exception 'invalid score';
  end if;
  insert into leaderboard (user_id, nickname, score, bike)
  values (uid, left(p_nickname, 16), p_score, left(p_bike, 24))
  on conflict (user_id) do update
    set score      = greatest(leaderboard.score, excluded.score),
        bike       = case when excluded.score > leaderboard.score then excluded.bike else leaderboard.bike end,
        nickname   = excluded.nickname,
        updated_at = now()
  returning score into best;
  return best;
end;
$$;

-- 내 순위
create or replace function public.my_rank()
returns table (rank bigint, score integer)
language sql
stable
security definer
set search_path = public
as $$
  select (select count(*) from leaderboard l2 where l2.score > l.score) + 1, l.score
  from leaderboard l
  where l.user_id = auth.uid();
$$;

revoke all on function public.submit_score(integer, text, text) from public, anon;
grant execute on function public.submit_score(integer, text, text) to authenticated;
revoke all on function public.my_rank() from public, anon;
grant execute on function public.my_rank() to authenticated;

-- ===================== 004 =====================

-- ---------------------------------------------------------------------
-- 랭킹 테이블 컬럼 (002·003 내용 포함)
-- ---------------------------------------------------------------------
alter table public.leaderboard add column if not exists dist    integer not null default 0 check (dist >= 0);
alter table public.leaderboard add column if not exists region  text    not null default 'ID';
alter table public.leaderboard add column if not exists box     text    not null default 'basic';
alter table public.leaderboard add column if not exists outfit  text    not null default 'jacket';
alter table public.leaderboard add column if not exists helmet  text    not null default 'basic';
alter table public.leaderboard add column if not exists flag    text    not null default '';
alter table public.leaderboard add column if not exists country_code text;
update public.leaderboard set country_code = coalesce(nullif(region, ''), 'ID') where country_code is null;
alter table public.leaderboard alter column country_code set default 'ID';
alter table public.leaderboard alter column country_code set not null;
alter table public.leaderboard drop constraint if exists leaderboard_country_code_check;
alter table public.leaderboard add constraint leaderboard_country_code_check check (country_code ~ '^[A-Z]{2}$');
alter table public.leaderboard add column if not exists best_at timestamptz not null default now();
create index if not exists leaderboard_country_score_idx on public.leaderboard (country_code, score desc, best_at asc);

-- ---------------------------------------------------------------------
-- 플레이어 데이터 (기기 저장소 대신 서버에 보관)
--   data         : 코인, 보유/장착 아이템, 최고 기록, 미션, 설정 등 (JSON)
--   country_code : 처음 IP 로 판별된 국가. 한 번 정해지면 클라이언트에서 바꿀 수 없음
--   is_admin     : 관리자 계정 (SQL 로만 지정). 관리자의 점수는 랭킹에 기록되지 않음
-- ---------------------------------------------------------------------
create table if not exists public.player_data (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  data         jsonb not null default '{}'::jsonb,
  country_code text check (country_code ~ '^[A-Z]{2}$'),
  is_admin     boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
alter table public.player_data enable row level security;
-- 직접 select/insert/update 정책 없음: 아래 함수로만 본인 행에 접근

create or replace function public.load_player_data()
returns table (data jsonb, country_code text, is_admin boolean)
language sql
stable
security definer
set search_path = public
as $$
  select p.data, p.country_code, p.is_admin from player_data p where p.user_id = auth.uid();
$$;

create or replace function public.save_player_data(p_data jsonb)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  ts  timestamptz := now();
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  if jsonb_typeof(p_data) <> 'object' or octet_length(p_data::text) > 65536 then
    raise exception 'invalid data';
  end if;
  if jsonb_typeof(p_data -> 'coins') <> 'number' or (p_data ->> 'coins')::numeric < 0 or (p_data ->> 'coins')::numeric > 100000000 then
    raise exception 'invalid coins';
  end if;
  insert into player_data (user_id, data, updated_at) values (uid, p_data, ts)
  on conflict (user_id) do update set data = excluded.data, updated_at = ts;
  return ts;
end;
$$;

-- 국가 고정: 아직 국가가 없을 때만 저장하고, 이미 있으면 기존 값을 그대로 돌려줌
create or replace function public.lock_country(p_country text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  cc  text := upper(left(coalesce(p_country, ''), 2));
  res text;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  if cc !~ '^[A-Z]{2}$' then
    raise exception 'invalid country';
  end if;
  insert into player_data (user_id, country_code) values (uid, cc)
  on conflict (user_id) do update set country_code = coalesce(player_data.country_code, excluded.country_code)
  returning player_data.country_code into res;
  return res;
end;
$$;

-- 점수 전송: 국가는 클라이언트 값이 아니라 player_data 에 고정된 국가를 사용. 관리자는 기록하지 않음(null 반환)
create or replace function public.submit_score_v4(
  p_score integer, p_dist integer, p_bike text, p_box text, p_outfit text, p_helmet text,
  p_flag text, p_nickname text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  uid  uuid := auth.uid();
  best integer;
  cc   text;
  adm  boolean;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  select p.country_code, p.is_admin into cc, adm from player_data p where p.user_id = uid;
  if coalesce(adm, false) then
    return null;
  end if;
  if cc is null then
    raise exception 'country not locked';
  end if;
  if p_score < 0 or p_score > 10000000 or p_dist < 0 or p_dist > 1000000 then
    raise exception 'invalid score';
  end if;
  insert into leaderboard (user_id, nickname, score, dist, bike, box, outfit, helmet, flag, region, country_code, best_at)
  values (uid, left(p_nickname, 16), p_score, p_dist, left(p_bike, 24), left(p_box, 24), left(p_outfit, 24), left(p_helmet, 24),
          left(coalesce(p_flag, ''), 2), cc, cc, now())
  on conflict (user_id) do update
    set score        = greatest(leaderboard.score, excluded.score),
        dist         = case when excluded.score > leaderboard.score then excluded.dist   else leaderboard.dist   end,
        bike         = case when excluded.score > leaderboard.score then excluded.bike   else leaderboard.bike   end,
        box          = case when excluded.score > leaderboard.score then excluded.box    else leaderboard.box    end,
        outfit       = case when excluded.score > leaderboard.score then excluded.outfit else leaderboard.outfit end,
        helmet       = case when excluded.score > leaderboard.score then excluded.helmet else leaderboard.helmet end,
        flag         = case when excluded.score > leaderboard.score then excluded.flag   else leaderboard.flag   end,
        best_at      = case when excluded.score > leaderboard.score then now()           else leaderboard.best_at end,
        region       = cc,
        country_code = cc,
        nickname     = excluded.nickname,
        updated_at   = now()
  returning score into best;
  return best;
end;
$$;

-- 내 국가 순위 (국가대표 바이크 잠금 해제는 이 함수의 rank = 1 일 때만)
create or replace function public.my_rank_v4()
returns table (rank bigint, score integer, country_code text)
language sql
stable
security definer
set search_path = public
as $$
  select (select count(*) from leaderboard l2
          where l2.country_code = l.country_code
            and (l2.score > l.score or (l2.score = l.score and l2.best_at < l.best_at))) + 1,
         l.score,
         l.country_code
  from leaderboard l
  join player_data p on p.user_id = l.user_id
  where l.user_id = auth.uid()
    and l.score > 0
    and l.country_code = p.country_code
    and not p.is_admin;
$$;

grant execute on function public.load_player_data() to authenticated;
grant execute on function public.save_player_data(jsonb) to authenticated;
grant execute on function public.lock_country(text) to authenticated;
grant execute on function public.submit_score_v4(integer, integer, text, text, text, text, text, text) to authenticated;
grant execute on function public.my_rank_v4() to authenticated;
revoke all on function public.load_player_data() from public, anon;
revoke all on function public.save_player_data(jsonb) from public, anon;
revoke all on function public.lock_country(text) from public, anon;
revoke all on function public.submit_score_v4(integer, integer, text, text, text, text, text, text) from public, anon;
revoke all on function public.my_rank_v4() from public, anon;

-- 예전 전송 함수는 막음 (국가 고정·관리자 차단을 우회하지 못하게)
do $$
begin
  revoke all on function public.submit_score(integer, text, text) from authenticated;
exception when undefined_function then null;
end $$;
do $$
begin
  revoke all on function public.submit_score_v2(integer, integer, text, text, text, text, text, text) from authenticated;
exception when undefined_function then null;
end $$;
do $$
begin
  revoke all on function public.submit_score_v3(integer, integer, text, text, text, text, text, text) from authenticated;
exception when undefined_function then null;
end $$;

-- ---------------------------------------------------------------------
-- admin 계정(아이디 admin)을 관리자로 지정 + 관리자 계정의 랭킹 기록 삭제
insert into public.player_data (user_id, is_admin)
select id, true from auth.users where email = 'admin@grabrider.game'
on conflict (user_id) do update set is_admin = true;
delete from public.leaderboard where user_id in (select user_id from public.player_data where is_admin);

-- ===================== 005 =====================

create or replace function public.admin_set_country(p_country text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  cc  text := upper(left(coalesce(p_country, ''), 2));
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  if not exists (select 1 from player_data p where p.user_id = uid and p.is_admin) then
    raise exception 'admin only';
  end if;
  if cc !~ '^[A-Z]{2}$' then
    raise exception 'invalid country';
  end if;
  update player_data set country_code = cc where user_id = uid;
  return cc;
end;
$$;

revoke all on function public.admin_set_country(text) from public, anon;
grant execute on function public.admin_set_country(text) to authenticated;

-- ===================== 006 =====================
-- 랭킹 행의 장착 아이템은 예전엔 최고 점수를 갱신할 때만 바뀌었음 → 장착을 바꿀 때마다 바로 반영
-- look: 페인트 등 추가 외형 정보 (JSON)

alter table public.leaderboard add column if not exists look jsonb not null default '{}'::jsonb;

create or replace function public.update_my_look(
  p_bike text, p_box text, p_outfit text, p_helmet text, p_flag text, p_look jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid   uuid := auth.uid();
  is_no1 boolean;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  -- 국가대표 바이크·배달통은 지금 국가 1위만 (서버에서 검증)
  select not exists (
    select 1 from leaderboard l2
    where l2.country_code = l.country_code
      and (l2.score > l.score or (l2.score = l.score and l2.best_at < l.best_at))
  ) into is_no1
  from leaderboard l where l.user_id = uid;
  if not coalesce(is_no1, false) then
    if p_bike = 'national' then p_bike := 'rookie'; end if;
    if p_box = 'national' then p_box := 'basic'; end if;
  end if;
  if jsonb_typeof(coalesce(p_look, '{}'::jsonb)) <> 'object' or octet_length(coalesce(p_look, '{}'::jsonb)::text) > 2048 then
    raise exception 'invalid look';
  end if;
  -- 관리자 계정은 랭킹에 없으므로 갱신하지 않음. 기록이 없으면 아무 것도 안 함
  update leaderboard l
     set bike   = left(coalesce(p_bike, l.bike), 24),
         box    = left(coalesce(p_box, l.box), 24),
         outfit = left(coalesce(p_outfit, l.outfit), 24),
         helmet = left(coalesce(p_helmet, l.helmet), 24),
         flag   = left(coalesce(p_flag, ''), 2),
         look   = coalesce(p_look, '{}'::jsonb)
   where l.user_id = uid
     and not exists (select 1 from player_data p where p.user_id = uid and p.is_admin);
end;
$$;

revoke all on function public.update_my_look(text, text, text, text, text, jsonb) from public, anon;
grant execute on function public.update_my_look(text, text, text, text, text, jsonb) to authenticated;

-- ===================== 007 =====================


-- ---------------------------------------------------------------------
-- 1) 코인 결제
--   결제 검증(웹훅/Edge Function, service_role)만 purchases 에 기록하고 pending_coins 를 올림.
--   게임은 claim_pending_coins() 로 받아 가서 자기 코인에 더함 → 클라이언트 저장이 결제 코인을 덮어쓰지 않음
-- ---------------------------------------------------------------------
alter table public.player_data add column if not exists pending_coins bigint not null default 0;
alter table public.player_data add column if not exists purchased_coins bigint not null default 0;

create table if not exists public.purchases (
  transaction_id text primary key,              -- 스토어 거래 ID (중복 지급 방지)
  user_id        uuid not null references auth.users (id) on delete cascade,
  product_id     text not null,
  coins          integer not null check (coins > 0),
  platform       text not null default 'unknown',
  raw            jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);
alter table public.purchases enable row level security;
-- 정책 없음: 클라이언트는 직접 읽고 쓸 수 없음

-- service_role(웹훅) 전용: 거래 1건 지급. 이미 처리한 거래면 false
create or replace function public.credit_purchase(
  p_tx text, p_user uuid, p_product text, p_coins integer, p_platform text, p_raw jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_coins is null or p_coins <= 0 or p_coins > 1000000 then
    raise exception 'invalid coins';
  end if;
  insert into purchases (transaction_id, user_id, product_id, coins, platform, raw)
  values (p_tx, p_user, p_product, p_coins, coalesce(p_platform, 'unknown'), coalesce(p_raw, '{}'::jsonb))
  on conflict (transaction_id) do nothing;
  if not found then
    return false;
  end if;
  insert into player_data (user_id, pending_coins, purchased_coins) values (p_user, p_coins, p_coins)
  on conflict (user_id) do update
    set pending_coins = player_data.pending_coins + excluded.pending_coins,
        purchased_coins = player_data.purchased_coins + excluded.purchased_coins;
  return true;
end;
$$;
revoke all on function public.credit_purchase(text, uuid, text, integer, text, jsonb) from public, anon, authenticated;
grant execute on function public.credit_purchase(text, uuid, text, integer, text, jsonb) to service_role;

-- 게임: 대기 중인 결제 코인을 받아 감 (원자적으로 0 으로 비움)
create or replace function public.claim_pending_coins()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  n   bigint;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  select p.pending_coins into n from player_data p where p.user_id = uid for update;
  if coalesce(n, 0) > 0 then
    update player_data set pending_coins = 0 where user_id = uid;
  end if;
  return coalesce(n, 0);
end;
$$;
revoke all on function public.claim_pending_coins() from public, anon;
grant execute on function public.claim_pending_coins() to authenticated;

-- ---------------------------------------------------------------------
-- 2) 계정 삭제 (앱스토어·플레이스토어 필수): auth.users 삭제 → player_data·leaderboard·purchases 연쇄 삭제
-- ---------------------------------------------------------------------
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  delete from public.leaderboard where user_id = uid;
  delete from public.player_data where user_id = uid;
  delete from auth.users where id = uid;
end;
$$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- ---------------------------------------------------------------------
-- 3) 서버 점수 검증 (submit_score_v4 교체: 같은 이름·인자라 권한은 그대로)
--   - 거리 대비 점수 상한 (니어미스·트릭 최대 배율 기준으로 넉넉하게: 거리 x 500 + 50,000. 위조 점수의 상한일 뿐 정상 기록은 막지 않음)
--   - 같은 계정의 연속 전송 3초 제한 (무시하고 기존 최고 점수 반환)
-- ---------------------------------------------------------------------
create or replace function public.submit_score_v4(
  p_score integer, p_dist integer, p_bike text, p_box text, p_outfit text, p_helmet text,
  p_flag text, p_nickname text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  uid  uuid := auth.uid();
  best integer;
  cc   text;
  adm  boolean;
  last timestamptz;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  select p.country_code, p.is_admin into cc, adm from player_data p where p.user_id = uid;
  if coalesce(adm, false) then
    return null;
  end if;
  if cc is null then
    raise exception 'country not locked';
  end if;
  if p_score < 0 or p_score > 10000000 or p_dist < 0 or p_dist > 1000000 then
    raise exception 'invalid score';
  end if;
  if p_score > p_dist::bigint * 500 + 50000 then
    raise exception 'score rejected';
  end if;
  -- 연속 전송(3초 이내)은 기록하지 않고 현재 최고 점수만 돌려줌
  select l.updated_at, l.score into last, best from leaderboard l where l.user_id = uid;
  if last is not null and last > now() - interval '3 seconds' then
    return best;
  end if;
  insert into leaderboard (user_id, nickname, score, dist, bike, box, outfit, helmet, flag, region, country_code, best_at)
  values (uid, left(p_nickname, 16), p_score, p_dist, left(p_bike, 24), left(p_box, 24), left(p_outfit, 24), left(p_helmet, 24),
          left(coalesce(p_flag, ''), 2), cc, cc, now())
  on conflict (user_id) do update
    set score        = greatest(leaderboard.score, excluded.score),
        dist         = case when excluded.score > leaderboard.score then excluded.dist   else leaderboard.dist   end,
        bike         = case when excluded.score > leaderboard.score then excluded.bike   else leaderboard.bike   end,
        box          = case when excluded.score > leaderboard.score then excluded.box    else leaderboard.box    end,
        outfit       = case when excluded.score > leaderboard.score then excluded.outfit else leaderboard.outfit end,
        helmet       = case when excluded.score > leaderboard.score then excluded.helmet else leaderboard.helmet end,
        flag         = case when excluded.score > leaderboard.score then excluded.flag   else leaderboard.flag   end,
        best_at      = case when excluded.score > leaderboard.score then now()           else leaderboard.best_at end,
        region       = cc,
        country_code = cc,
        nickname     = excluded.nickname,
        updated_at   = now()
  returning score into best;
  return best;
end;
$$;

-- ===================== 008 =====================
--   app_config(key, value jsonb): 누구나 읽기, 쓰기는 관리자(player_data.is_admin)만 admin_set_config() 로
--   게임은 실행할 때 'economy' 키를 읽어 js/config.js 기본값을 덮어씀. 값이 없으면 기본값 그대로
--
-- economy 예시 (필요한 항목만 넣으면 됨):
--   {
--     "coinValue": 2, "dropReward": 50, "hotReward": 200, "kmBonus": 50, "continueCost": 500,
--     "gachaPrice": 4000, "gachaRefund": 1600, "missionBase": 80, "missionStep": 80,
--     "freeCoins": 200, "freeCoinsCooldownSec": 1200,
--     "prices": { "box": { "aquarium": 40000 }, "helmet": { "merlion": 40000 }, "boost": { "shield": 350 } }
--   }
--
-- notices 예시 (게임 메뉴 NEWS 탭. 최신 글을 맨 앞에, id 가 바뀌면 NEWS 버튼에 빨간 점):
--   select admin_set_config('notices', '[
--     {"id": "2026-12-01-xmas", "date": "2026-12-01", "tag": "EVENT", "title": "Christmas week: 2x coins",
--      "body": "From Dec 20 to Dec 27 every coin is worth double.\nMerry Christmas, riders!"}
--   ]');
--   tag: UPDATE / EVENT / NOTICE / MAINTENANCE

create table if not exists public.app_config (
  key        text primary key,
  value      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
alter table public.app_config enable row level security;

drop policy if exists "app_config read" on public.app_config;
create policy "app_config read" on public.app_config for select to anon, authenticated using (true);
-- insert/update/delete 정책 없음 → 직접 쓰기 불가, 아래 관리자 함수로만

create or replace function public.admin_set_config(p_key text, p_value jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null or not exists (select 1 from player_data p where p.user_id = uid and p.is_admin) then
    raise exception 'admin only';
  end if;
  if p_key is null or p_key !~ '^[a-z_]{1,40}$' then
    raise exception 'invalid key';
  end if;
  insert into app_config (key, value, updated_at, updated_by) values (p_key, coalesce(p_value, '{}'::jsonb), now(), uid)
  on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = uid;
end;
$$;
revoke all on function public.admin_set_config(text, jsonb) from public, anon;
grant execute on function public.admin_set_config(text, jsonb) to authenticated;

-- ===================== 009 =====================
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

-- API(PostgREST)가 새 테이블·함수를 바로 알아보도록 스키마 캐시 새로고침
notify pgrst, 'reload schema';

-- ===================== 010 관리자 권한 강화 =====================

-- Grub Rider 010: 관리자 권한 강화
--   · 플레이 기록(run_logs) 검색 · 수정 · 삭제
--   · 랭킹 기록(leaderboard) 수정 · 랭킹에서 제외
--   · 플레이어 재산(코인 · 보유 아이템 · 부스트 · 장착) · 닉네임 · 국가 수정
--   · 정지(밴): 정지된 계정은 랭킹에 올라가지 않음
--   · 모든 관리자 작업은 admin_actions 에 남고, 관리자 페이지 '작업 기록' 탭에서 볼 수 있음
--   · data_rev: 관리자가 재산을 고치면 1 증가 → 게임이 들고 있던 옛 데이터로 덮어쓰지 못하고 서버 값을 다시 받음
-- 009_ops.sql 다음에 SQL Editor 에서 실행하세요. 여러 번 실행해도 안전합니다.

-- ---------------------------------------------------------------------
-- 0) 컬럼
-- ---------------------------------------------------------------------
alter table public.player_data add column if not exists data_rev   integer not null default 0; -- 관리자 수정 횟수
alter table public.player_data add column if not exists seen_rev   integer not null default 0; -- 옛 게임(v1 저장)이 마지막으로 받은 data_rev
alter table public.player_data add column if not exists banned     boolean not null default false;
alter table public.player_data add column if not exists ban_reason text not null default '';

-- ---------------------------------------------------------------------
-- 1) 저장 동기화: 관리자가 고친 값을 게임이 덮어쓰지 않게
-- ---------------------------------------------------------------------
-- 옛 버전 게임용: 불러올 때 지금 rev 를 본 것으로 표시
create or replace function public.load_player_data()
returns table (data jsonb, country_code text, is_admin boolean)
language plpgsql
security definer
set search_path = public
as $$
begin
  update player_data p set seen_rev = p.data_rev where p.user_id = auth.uid() and p.seen_rev <> p.data_rev;
  return query select p.data, p.country_code, p.is_admin from player_data p where p.user_id = auth.uid();
end;
$$;
revoke all on function public.load_player_data() from public, anon;
grant execute on function public.load_player_data() to authenticated;

-- 옛 버전 게임용 저장: 관리자 수정 뒤 아직 다시 불러오지 않은 게임의 저장은 무시 (관리자 값 유지)
create or replace function public.save_player_data(p_data jsonb)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  ts timestamptz := now();
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  if jsonb_typeof(p_data) <> 'object' or octet_length(p_data::text) > 65536 then
    raise exception 'invalid data';
  end if;
  if jsonb_typeof(p_data -> 'coins') <> 'number' or (p_data ->> 'coins')::numeric < 0 or (p_data ->> 'coins')::numeric > 100000000 then
    raise exception 'invalid coins';
  end if;
  if exists (select 1 from player_data p where p.user_id = uid and p.data_rev > p.seen_rev) then
    return ts;
  end if;
  insert into player_data (user_id, data, updated_at) values (uid, p_data, ts)
  on conflict (user_id) do update set data = excluded.data, updated_at = ts;
  return ts;
end;
$$;
revoke all on function public.save_player_data(jsonb) from public, anon;
grant execute on function public.save_player_data(jsonb) to authenticated;

-- 새 게임용 불러오기: rev 포함
create or replace function public.load_player_data_v2()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare res jsonb;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  update player_data p set seen_rev = p.data_rev where p.user_id = auth.uid() and p.seen_rev <> p.data_rev;
  select jsonb_build_object('data', p.data, 'country_code', p.country_code, 'is_admin', p.is_admin, 'rev', p.data_rev, 'banned', p.banned)
    into res from player_data p where p.user_id = auth.uid();
  return res; -- 새 계정이면 null
end;
$$;
revoke all on function public.load_player_data_v2() from public, anon;
grant execute on function public.load_player_data_v2() to authenticated;

-- 새 게임용 저장: 게임이 아는 rev 가 서버보다 낮으면 저장하지 않고 서버 데이터를 돌려줌 → 게임이 그 값으로 교체
create or replace function public.save_player_data_v2(p_data jsonb, p_rev integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  cur record;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if jsonb_typeof(p_data) <> 'object' or octet_length(p_data::text) > 65536 then raise exception 'invalid data'; end if;
  if jsonb_typeof(p_data -> 'coins') <> 'number' or (p_data ->> 'coins')::numeric < 0 or (p_data ->> 'coins')::numeric > 100000000 then
    raise exception 'invalid coins';
  end if;
  select p.data, p.data_rev into cur from player_data p where p.user_id = uid;
  if found and cur.data_rev > coalesce(p_rev, 0) then
    update player_data set seen_rev = data_rev where user_id = uid;
    return jsonb_build_object('stale', true, 'rev', cur.data_rev, 'data', cur.data);
  end if;
  insert into player_data (user_id, data, updated_at) values (uid, p_data, now())
  on conflict (user_id) do update set data = excluded.data, updated_at = now();
  return jsonb_build_object('ok', true, 'rev', coalesce(cur.data_rev, 0));
end;
$$;
revoke all on function public.save_player_data_v2(jsonb, integer) from public, anon;
grant execute on function public.save_player_data_v2(jsonb, integer) to authenticated;

-- 정지된 계정은 랭킹에 쓰지 못함 (점수 제출 함수와 무관하게 테이블에서 막음)
create or replace function public._leaderboard_block_banned()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from player_data p where p.user_id = new.user_id and p.banned) then
    return null;
  end if;
  return new;
end;
$$;
drop trigger if exists leaderboard_block_banned on public.leaderboard;
create trigger leaderboard_block_banned before insert or update on public.leaderboard
  for each row execute function public._leaderboard_block_banned();

-- ---------------------------------------------------------------------
-- 2) 플레이 기록 조회 · 수정 · 삭제
-- ---------------------------------------------------------------------
-- p_q: 닉네임·아이디 일부 또는 사용자 UUID / p_sort: recent | score | dist | coins
create or replace function public.admin_list_runs(
  p_user uuid default null, p_q text default null, p_country text default null, p_days int default 30,
  p_min_score int default 0, p_sort text default 'recent', p_limit int default 100, p_offset int default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  q text := lower(trim(coalesce(p_q, '')));
  since timestamptz := now() - make_interval(days => least(greatest(coalesce(p_days, 30), 1), 3650));
  res jsonb;
  total bigint;
begin
  perform public._require_admin();
  with base as (
    select r.*, split_part(u.email, '@', 1) as login_id,
           coalesce(l.nickname, u.raw_user_meta_data ->> 'nickname', split_part(u.email, '@', 1)) as nickname
      from run_logs r
      left join auth.users u on u.id = r.user_id
      left join leaderboard l on l.user_id = r.user_id
     where r.created_at >= since
       and r.score >= coalesce(p_min_score, 0)
       and (p_user is null or r.user_id = p_user)
       and (p_country is null or r.country_code = p_country)
       and (q = '' or r.user_id::text = q or lower(coalesce(split_part(u.email, '@', 1), '')) like '%' || q || '%'
            or lower(coalesce(l.nickname, '')) like '%' || q || '%')
  )
  select (select count(*) from base),
         coalesce((select jsonb_agg(to_jsonb(x)) from (
           select id, user_id, login_id, nickname, country_code, theme, dist, score, coins, duration_s, bike, app_build, created_at
             from base
            order by case p_sort when 'score' then score when 'dist' then dist when 'coins' then coins else null end desc nulls last,
                     created_at desc
            limit least(greatest(p_limit, 1), 500) offset greatest(p_offset, 0)) x), '[]'::jsonb)
    into total, res;
  return jsonb_build_object('total', total, 'rows', res);
end;
$$;
revoke all on function public.admin_list_runs(uuid, text, text, int, int, text, int, int) from public, anon;
grant execute on function public.admin_list_runs(uuid, text, text, int, int, text, int, int) to authenticated;

create or replace function public.admin_update_run(p_id bigint, p_score int, p_dist int, p_coins int, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare before jsonb; tgt uuid;
begin
  perform public._require_admin();
  if p_score < 0 or p_score > 10000000 or p_dist < 0 or p_dist > 1000000 or p_coins < 0 or p_coins > 1000000 then
    raise exception 'invalid values';
  end if;
  select jsonb_build_object('score', score, 'dist', dist, 'coins', coins), user_id into before, tgt from run_logs where id = p_id;
  if before is null then raise exception 'run not found'; end if;
  update run_logs set score = p_score, dist = p_dist, coins = p_coins where id = p_id;
  insert into admin_actions (admin_id, target_id, action, detail)
  values (auth.uid(), tgt, 'edit_run', jsonb_build_object('run_id', p_id, 'before', before,
          'after', jsonb_build_object('score', p_score, 'dist', p_dist, 'coins', p_coins), 'reason', left(coalesce(p_reason, ''), 200)));
end;
$$;
revoke all on function public.admin_update_run(bigint, int, int, int, text) from public, anon;
grant execute on function public.admin_update_run(bigint, int, int, int, text) to authenticated;

create or replace function public.admin_delete_run(p_id bigint, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare before jsonb; tgt uuid;
begin
  perform public._require_admin();
  select to_jsonb(r) - 'user_id', r.user_id into before, tgt from run_logs r where r.id = p_id;
  if before is null then raise exception 'run not found'; end if;
  delete from run_logs where id = p_id;
  insert into admin_actions (admin_id, target_id, action, detail)
  values (auth.uid(), tgt, 'delete_run', jsonb_build_object('run', before, 'reason', left(coalesce(p_reason, ''), 200)));
end;
$$;
revoke all on function public.admin_delete_run(bigint, text) from public, anon;
grant execute on function public.admin_delete_run(bigint, text) to authenticated;

-- ---------------------------------------------------------------------
-- 3) 랭킹 기록 수정 · 제외
-- ---------------------------------------------------------------------
-- 최고 점수·거리를 지정한 값으로 (랭킹 + 게임 내 최고 기록 둘 다). p_remove = true 면 랭킹에서 지움
create or replace function public.admin_set_record(p_user uuid, p_score int, p_dist int, p_remove boolean, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare before jsonb;
begin
  perform public._require_admin();
  select jsonb_build_object('score', l.score, 'dist', l.dist) into before from leaderboard l where l.user_id = p_user;
  if coalesce(p_remove, false) then
    delete from leaderboard where user_id = p_user;
    update player_data set data = data || jsonb_build_object('best', 0, 'bestDist', 0), data_rev = data_rev + 1, updated_at = now()
     where user_id = p_user;
  else
    if p_score is null or p_score < 0 or p_score > 10000000 or p_dist is null or p_dist < 0 or p_dist > 1000000 then
      raise exception 'invalid values';
    end if;
    if before is null then raise exception 'player has no ranking record'; end if;
    update leaderboard set score = p_score, dist = p_dist, updated_at = now() where user_id = p_user;
    update player_data set data = data || jsonb_build_object('best', p_score, 'bestDist', p_dist), data_rev = data_rev + 1, updated_at = now()
     where user_id = p_user;
  end if;
  insert into admin_actions (admin_id, target_id, action, detail)
  values (auth.uid(), p_user, case when coalesce(p_remove, false) then 'remove_record' else 'edit_record' end,
          jsonb_build_object('before', before, 'after', case when coalesce(p_remove, false) then null
                             else jsonb_build_object('score', p_score, 'dist', p_dist) end, 'reason', left(coalesce(p_reason, ''), 200)));
end;
$$;
revoke all on function public.admin_set_record(uuid, int, int, boolean, text) from public, anon;
grant execute on function public.admin_set_record(uuid, int, int, boolean, text) to authenticated;

-- ---------------------------------------------------------------------
-- 4) 플레이어 재산 · 프로필 수정
-- ---------------------------------------------------------------------
-- p_patch: 바꿀 키만. data 키(coins, owned*, boosts, bike/box/outfit/helmet/flag, streak) + 프로필(nickname, country_code)
create or replace function public.admin_update_player(p_user uuid, p_patch jsonb, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  data_keys text[] := array['coins', 'ownedBikes', 'ownedBoxes', 'ownedOutfits', 'ownedHelmets', 'ownedFlags', 'ownedPaints',
                            'boosts', 'bike', 'box', 'outfit', 'helmet', 'flag', 'streak'];
  k text;
  dpatch jsonb := '{}'::jsonb;
  before jsonb := '{}'::jsonb;
  cur jsonb;
  nick text;
  cc text;
begin
  perform public._require_admin();
  if jsonb_typeof(p_patch) <> 'object' then raise exception 'invalid patch'; end if;
  if not exists (select 1 from auth.users where id = p_user) then raise exception 'player not found'; end if;
  insert into player_data (user_id) values (p_user) on conflict (user_id) do nothing;
  select data into cur from player_data where user_id = p_user;

  for k in select jsonb_object_keys(p_patch) loop
    if k = any (data_keys) then
      if k = 'coins' and (jsonb_typeof(p_patch -> k) <> 'number' or (p_patch ->> k)::numeric < 0 or (p_patch ->> k)::numeric > 100000000) then
        raise exception 'invalid coins';
      end if;
      if k = 'streak' and (jsonb_typeof(p_patch -> k) <> 'number' or (p_patch ->> k)::numeric < 0) then raise exception 'invalid streak'; end if;
      if k like 'owned%' and (jsonb_typeof(p_patch -> k) <> 'array'
          or exists (select 1 from jsonb_array_elements(p_patch -> k) e where jsonb_typeof(e) <> 'string')) then
        raise exception 'invalid %', k;
      end if;
      if k = 'boosts' and (jsonb_typeof(p_patch -> k) <> 'object'
          or exists (select 1 from jsonb_each(p_patch -> k) e where jsonb_typeof(e.value) <> 'number' or (e.value #>> '{}')::numeric < 0)) then
        raise exception 'invalid boosts';
      end if;
      if k in ('bike', 'box', 'outfit', 'helmet', 'flag') and jsonb_typeof(p_patch -> k) <> 'string' then raise exception 'invalid %', k; end if;
      dpatch := dpatch || jsonb_build_object(k, p_patch -> k);
      before := before || jsonb_build_object(k, cur -> k);
    elsif k not in ('nickname', 'country_code') then
      raise exception 'unknown key %', k;
    end if;
  end loop;

  if dpatch <> '{}'::jsonb then
    update player_data set data = data || dpatch, data_rev = data_rev + 1, updated_at = now() where user_id = p_user;
  end if;
  if p_patch ? 'nickname' then
    nick := trim(p_patch ->> 'nickname');
    if char_length(nick) not between 2 and 16 then raise exception 'nickname must be 2-16 characters'; end if;
    select to_jsonb(l.nickname) into cur from leaderboard l where l.user_id = p_user;
    before := before || jsonb_build_object('nickname', cur);
    update leaderboard set nickname = nick where user_id = p_user;
    update auth.users set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('nickname', nick) where id = p_user;
    update player_data set data = data || jsonb_build_object('lastName', nick), data_rev = data_rev + 1 where user_id = p_user;
  end if;
  if p_patch ? 'country_code' then
    cc := upper(trim(p_patch ->> 'country_code'));
    if cc !~ '^[A-Z]{2}$' then raise exception 'invalid country'; end if;
    select to_jsonb(p.country_code) into cur from player_data p where p.user_id = p_user;
    before := before || jsonb_build_object('country_code', cur);
    update player_data set country_code = cc where user_id = p_user;
    update leaderboard set country_code = cc, region = cc where user_id = p_user;
  end if;

  insert into admin_actions (admin_id, target_id, action, detail)
  values (auth.uid(), p_user, 'edit_player', jsonb_build_object('before', before, 'after', p_patch, 'reason', left(coalesce(p_reason, ''), 200)));
  return (select jsonb_build_object('rev', data_rev) from player_data where user_id = p_user);
end;
$$;
revoke all on function public.admin_update_player(uuid, jsonb, text) from public, anon;
grant execute on function public.admin_update_player(uuid, jsonb, text) to authenticated;

-- 정지 / 해제. 정지하면 랭킹에서도 지움
create or replace function public.admin_set_ban(p_user uuid, p_banned boolean, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  if p_user = auth.uid() then raise exception 'cannot ban yourself'; end if;
  insert into player_data (user_id) values (p_user) on conflict (user_id) do nothing;
  update player_data set banned = coalesce(p_banned, false), ban_reason = left(coalesce(p_reason, ''), 200) where user_id = p_user;
  if coalesce(p_banned, false) then delete from leaderboard where user_id = p_user; end if;
  insert into admin_actions (admin_id, target_id, action, detail)
  values (auth.uid(), p_user, case when coalesce(p_banned, false) then 'ban' else 'unban' end,
          jsonb_build_object('reason', left(coalesce(p_reason, ''), 200)));
end;
$$;
revoke all on function public.admin_set_ban(uuid, boolean, text) from public, anon;
grant execute on function public.admin_set_ban(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------
-- 5) 플레이어 상세에 정지 상태 · rev 추가 + 관리자 작업 기록 목록
-- ---------------------------------------------------------------------
create or replace function public.admin_player_extra(p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare res jsonb;
begin
  perform public._require_admin();
  select jsonb_build_object('banned', coalesce(p.banned, false), 'ban_reason', coalesce(p.ban_reason, ''),
                            'data_rev', coalesce(p.data_rev, 0), 'seen_rev', coalesce(p.seen_rev, 0))
    into res from player_data p where p.user_id = p_user;
  return coalesce(res, jsonb_build_object('banned', false, 'ban_reason', '', 'data_rev', 0, 'seen_rev', 0));
end;
$$;
revoke all on function public.admin_player_extra(uuid) from public, anon;
grant execute on function public.admin_player_extra(uuid) to authenticated;

create or replace function public.admin_list_actions(p_limit int default 100, p_offset int default 0)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare res jsonb;
begin
  perform public._require_admin();
  select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb) into res from (
    select a.id, a.action, a.detail, a.created_at, a.target_id,
           split_part(au.email, '@', 1) as admin_login,
           coalesce(l.nickname, tu.raw_user_meta_data ->> 'nickname', split_part(tu.email, '@', 1)) as target_name
      from admin_actions a
      left join auth.users au on au.id = a.admin_id
      left join auth.users tu on tu.id = a.target_id
      left join leaderboard l on l.user_id = a.target_id
     order by a.created_at desc
     limit least(greatest(p_limit, 1), 500) offset greatest(p_offset, 0)
  ) x;
  return res;
end;
$$;
revoke all on function public.admin_list_actions(int, int) from public, anon;
grant execute on function public.admin_list_actions(int, int) to authenticated;

notify pgrst, 'reload schema';
