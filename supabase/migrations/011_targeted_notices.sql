-- Grub Rider 011: 특정 플레이어에게만 보이는 개인 공지
--   · 국가별 공지는 공개 공지(app_config 'notices')에 countries 목록을 넣어 게임이 걸러 보여 줌 (SQL 필요 없음)
--   · 개인 공지는 공개 설정에 넣으면 누구나 읽을 수 있으므로, 받는 사람만 읽을 수 있는 표에 따로 저장
-- 010_admin_power.sql 다음에 SQL Editor 에서 실행하세요. 여러 번 실행해도 안전합니다.

create table if not exists public.player_notices (
  id         bigserial primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  notice     jsonb not null,               -- { date, tag, title, body, i18n: { ko: { title, body }, vi: … } }
  admin_id   uuid,
  created_at timestamptz not null default now()
);
create index if not exists player_notices_user_idx on public.player_notices (user_id, created_at desc);
alter table public.player_notices enable row level security;
-- 직접 읽기·쓰기 정책 없음: 아래 함수로만 (플레이어는 자기 것만)

-- 게임: 내 개인 공지 (최근 180일, 최대 20개)
create or replace function public.my_notices()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare res jsonb;
begin
  if auth.uid() is null then return '[]'::jsonb; end if;
  select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb) into res from (
    select id, notice, created_at from player_notices
     where user_id = auth.uid() and created_at > now() - interval '180 days'
     order by created_at desc limit 20
  ) x;
  return res;
end;
$$;
revoke all on function public.my_notices() from public, anon;
grant execute on function public.my_notices() to authenticated;

-- 관리자: 여러 명에게 같은 개인 공지 보내기. 보낸 수 반환
create or replace function public.admin_send_notice(p_users uuid[], p_notice jsonb)
returns integer
language plpgsql
security definer
set search_path = public, auth
as $$
declare n integer;
begin
  perform public._require_admin();
  if coalesce(jsonb_typeof(p_notice), '') <> 'object' or coalesce(jsonb_typeof(p_notice -> 'title'), '') <> 'string'
     or char_length(p_notice ->> 'title') not between 1 and 80 or octet_length(p_notice::text) > 32768 then
    raise exception 'invalid notice';
  end if;
  if p_users is null or cardinality(p_users) = 0 or cardinality(p_users) > 500 then raise exception 'choose 1-500 players'; end if;
  with ins as (
    insert into player_notices (user_id, notice, admin_id)
    select u.id, p_notice, auth.uid() from auth.users u where u.id = any (p_users)
    returning user_id
  ), logged as (
    insert into admin_actions (admin_id, target_id, action, detail)
    select auth.uid(), user_id, 'send_notice', jsonb_build_object('title', p_notice ->> 'title') from ins
    returning 1
  )
  select count(*) into n from logged;
  return n;
end;
$$;
revoke all on function public.admin_send_notice(uuid[], jsonb) from public, anon;
grant execute on function public.admin_send_notice(uuid[], jsonb) to authenticated;

-- 관리자: 보낸 개인 공지 목록 / 삭제
create or replace function public.admin_list_sent_notices(p_limit int default 100)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare res jsonb;
begin
  perform public._require_admin();
  select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb) into res from (
    select n.id, n.user_id, n.notice, n.created_at,
           coalesce(l.nickname, u.raw_user_meta_data ->> 'nickname', split_part(u.email, '@', 1)) as nickname
      from player_notices n
      left join auth.users u on u.id = n.user_id
      left join leaderboard l on l.user_id = n.user_id
     order by n.created_at desc
     limit least(greatest(p_limit, 1), 500)
  ) x;
  return res;
end;
$$;
revoke all on function public.admin_list_sent_notices(int) from public, anon;
grant execute on function public.admin_list_sent_notices(int) to authenticated;

create or replace function public.admin_delete_player_notice(p_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  delete from player_notices where id = p_id;
end;
$$;
revoke all on function public.admin_delete_player_notice(bigint) from public, anon;
grant execute on function public.admin_delete_player_notice(bigint) to authenticated;

notify pgrst, 'reload schema';
