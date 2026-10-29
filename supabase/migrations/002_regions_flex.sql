-- Grab Rider 002: 지역 랭킹 + 주행 거리 + 장착 아이템(전광판 / Flex View 용)
-- schema.sql 을 이미 실행한 프로젝트의 SQL Editor 에서 이 파일을 실행하세요. 여러 번 실행해도 안전합니다.

alter table public.leaderboard add column if not exists dist   integer not null default 0 check (dist >= 0);
alter table public.leaderboard add column if not exists region text    not null default 'ID';
alter table public.leaderboard add column if not exists box    text    not null default 'basic';
alter table public.leaderboard add column if not exists outfit text    not null default 'jacket';
alter table public.leaderboard add column if not exists helmet text    not null default 'basic';

create index if not exists leaderboard_region_score_idx on public.leaderboard (region, score desc);

-- 최고 점수 갱신 시 그 판의 거리·장착 아이템·지역도 함께 저장
create or replace function public.submit_score_v2(
  p_score integer, p_dist integer, p_bike text, p_box text, p_outfit text, p_helmet text,
  p_region text, p_nickname text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  uid  uuid := auth.uid();
  best integer;
  reg  text := upper(left(coalesce(p_region, 'ID'), 2));
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  if p_score < 0 or p_score > 10000000 or p_dist < 0 or p_dist > 1000000 then
    raise exception 'invalid score';
  end if;
  if reg not in ('ID', 'VN', 'TH', 'KR', 'JP', 'SG', 'US', 'FR') then
    reg := 'ID';
  end if;
  insert into leaderboard (user_id, nickname, score, dist, bike, box, outfit, helmet, region)
  values (uid, left(p_nickname, 16), p_score, p_dist, left(p_bike, 24), left(p_box, 24), left(p_outfit, 24), left(p_helmet, 24), reg)
  on conflict (user_id) do update
    set score      = greatest(leaderboard.score, excluded.score),
        dist       = case when excluded.score > leaderboard.score then excluded.dist   else leaderboard.dist   end,
        bike       = case when excluded.score > leaderboard.score then excluded.bike   else leaderboard.bike   end,
        box        = case when excluded.score > leaderboard.score then excluded.box    else leaderboard.box    end,
        outfit     = case when excluded.score > leaderboard.score then excluded.outfit else leaderboard.outfit end,
        helmet     = case when excluded.score > leaderboard.score then excluded.helmet else leaderboard.helmet end,
        region     = excluded.region,
        nickname   = excluded.nickname,
        updated_at = now()
  returning score into best;
  return best;
end;
$$;

-- 내 순위 (p_region 이 null 이면 글로벌)
create or replace function public.my_rank_v2(p_region text default null)
returns table (rank bigint, score integer)
language sql
stable
security definer
set search_path = public
as $$
  select (select count(*) from leaderboard l2
          where l2.score > l.score and (p_region is null or l2.region = p_region)) + 1,
         l.score
  from leaderboard l
  where l.user_id = auth.uid() and (p_region is null or l.region = p_region);
$$;

revoke all on function public.submit_score_v2(integer, integer, text, text, text, text, text, text) from public, anon;
grant execute on function public.submit_score_v2(integer, integer, text, text, text, text, text, text) to authenticated;
revoke all on function public.my_rank_v2(text) from public, anon;
grant execute on function public.my_rank_v2(text) to authenticated;
