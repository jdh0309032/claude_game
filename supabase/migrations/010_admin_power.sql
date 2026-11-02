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
