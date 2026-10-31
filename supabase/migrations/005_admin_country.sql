-- Grub Rider 005: 관리자만 국가 변경 (004 실행 후 실행하세요. 여러 번 실행해도 안전합니다)
-- 일반 계정은 lock_country 로 처음 고정된 국가를 바꿀 수 없고, 관리자(player_data.is_admin)만 이 함수로 변경 가능

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
