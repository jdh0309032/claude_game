-- Grub Rider 007: 코인 결제 원장 + 계정 삭제 + 서버 점수 검증
-- 004·005·006 실행 후 실행하세요. 여러 번 실행해도 안전합니다.

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
