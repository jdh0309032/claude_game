-- 008: 앱 운영 설정 (가격·보상·공지·이벤트를 앱 업데이트 없이 바꾸기)
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
