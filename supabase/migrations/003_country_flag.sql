-- Grub Rider 003: 국가(country_code) 기준 랭킹 + 국가 1위 '국기' 아이템 검증
-- SQL Editor 에서 실행하세요. 002 를 실행하지 않았어도 이 파일 하나로 충분하며, 여러 번 실행해도 안전합니다.

-- 002 의 컬럼 (없으면 추가)
alter table public.leaderboard add column if not exists dist   integer not null default 0 check (dist >= 0);
alter table public.leaderboard add column if not exists region text    not null default 'ID';
alter table public.leaderboard add column if not exists box    text    not null default 'basic';
alter table public.leaderboard add column if not exists outfit text    not null default 'jacket';
alter table public.leaderboard add column if not exists helmet text    not null default 'basic';

-- 국가 코드 (ISO 3166-1 alpha-2). 기존 기록은 region 값을 그대로 옮김
alter table public.leaderboard add column if not exists country_code text;
update public.leaderboard set country_code = coalesce(nullif(region, ''), 'ID') where country_code is null;
alter table public.leaderboard alter column country_code set default 'ID';
alter table public.leaderboard alter column country_code set not null;
alter table public.leaderboard drop constraint if exists leaderboard_country_code_check;
alter table public.leaderboard add constraint leaderboard_country_code_check check (country_code ~ '^[A-Z]{2}$');

-- 최고 점수를 낸 시각 (동점이면 먼저 낸 사람이 위)
alter table public.leaderboard add column if not exists best_at timestamptz not null default now();

create index if not exists leaderboard_country_score_idx on public.leaderboard (country_code, score desc, best_at asc);

-- 최고 점수 갱신 시 그 판의 거리·장착 아이템도 저장. 국가는 항상 최신 값으로
create or replace function public.submit_score_v3(
  p_score integer, p_dist integer, p_bike text, p_box text, p_outfit text, p_helmet text,
  p_country text, p_nickname text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  uid  uuid := auth.uid();
  best integer;
  cc   text := upper(left(coalesce(p_country, ''), 2));
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  if p_score < 0 or p_score > 10000000 or p_dist < 0 or p_dist > 1000000 then
    raise exception 'invalid score';
  end if;
  if cc !~ '^[A-Z]{2}$' then
    raise exception 'invalid country';
  end if;
  insert into leaderboard (user_id, nickname, score, dist, bike, box, outfit, helmet, region, country_code, best_at)
  values (uid, left(p_nickname, 16), p_score, p_dist, left(p_bike, 24), left(p_box, 24), left(p_outfit, 24), left(p_helmet, 24), cc, cc, now())
  on conflict (user_id) do update
    set score        = greatest(leaderboard.score, excluded.score),
        dist         = case when excluded.score > leaderboard.score then excluded.dist   else leaderboard.dist   end,
        bike         = case when excluded.score > leaderboard.score then excluded.bike   else leaderboard.bike   end,
        box          = case when excluded.score > leaderboard.score then excluded.box    else leaderboard.box    end,
        outfit       = case when excluded.score > leaderboard.score then excluded.outfit else leaderboard.outfit end,
        helmet       = case when excluded.score > leaderboard.score then excluded.helmet else leaderboard.helmet end,
        best_at      = case when excluded.score > leaderboard.score then now()           else leaderboard.best_at end,
        region       = excluded.country_code,
        country_code = excluded.country_code,
        nickname     = excluded.nickname,
        updated_at   = now()
  returning score into best;
  return best;
end;
$$;

-- 내 국가 순위. p_country 가 null 이면 내 기록에 저장된 국가 기준
-- '국기' 아이템 잠금 해제는 이 함수의 rank = 1 일 때만 (클라이언트 값이 아닌 DB 기준)
create or replace function public.my_rank_v3(p_country text default null)
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
  where l.user_id = auth.uid()
    and l.score > 0
    and (p_country is null or l.country_code = upper(p_country));
$$;

revoke all on function public.submit_score_v3(integer, integer, text, text, text, text, text, text) from public, anon;
grant execute on function public.submit_score_v3(integer, integer, text, text, text, text, text, text) to authenticated;
revoke all on function public.my_rank_v3(text) from public, anon;
grant execute on function public.my_rank_v3(text) to authenticated;
