-- Grab Rider 006: 랭킹 3D 미리보기 동기화 (004·005 실행 후 실행하세요. 여러 번 실행해도 안전합니다)
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
