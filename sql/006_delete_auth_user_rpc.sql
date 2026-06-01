create or replace function public.delete_auth_user_by_email(target_email text)
returns boolean
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  normalized_email text := lower(trim(coalesce(target_email, '')));
  target_user_id uuid;
begin
  if normalized_email = '' then
    raise exception 'Email is required';
  end if;

  if not public.current_app_user_is_admin() then
    raise exception 'Admin only';
  end if;

  select users.id
    into target_user_id
  from auth.users
  where lower(users.email) = normalized_email
  limit 1;

  if target_user_id is null then
    return false;
  end if;

  delete from auth.users
  where users.id = target_user_id;

  return true;
end;
$$;

revoke all on function public.delete_auth_user_by_email(text) from public;
grant execute on function public.delete_auth_user_by_email(text) to authenticated;
