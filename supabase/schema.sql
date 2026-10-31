-- Grub Rider 글로벌 랭킹 스키마 (Supabase SQL Editor 에서 실행)
-- 1) Authentication > Providers > Email 에서 "Confirm email" 을 끄세요 (아이디 가입용 가상 이메일 사용)
-- 2) 이 스크립트를 실행한 뒤 js/config.js 에 SUPABASE_URL / SUPABASE_ANON_KEY 를 입력하세요

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
