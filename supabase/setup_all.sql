-- Grub Rider: Supabase 전체 설정 (SQL Editor 에 통째로 붙여넣고 한 번 실행). 여러 번 실행해도 안전합니다.
-- 포함: schema.sql(기본 랭킹) + 004(서버 저장·국가 고정·관리자) + admin 계정 지정 + 005(관리자 국가 변경) + 006(랭킹 외형 동기화) + 007(코인 결제·계정 삭제·점수 검증) + 008(운영 설정: 가격·보상·공지)

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
