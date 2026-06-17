alter table public.detailed_permissions
  add column if not exists credential_id uuid references public.entry_credentials(id) on delete cascade;

create index if not exists idx_detailed_permissions_credential_id on public.detailed_permissions(credential_id);

drop index if exists public.detailed_permissions_user_project_system_idx;

create unique index if not exists detailed_permissions_user_project_system_idx
  on public.detailed_permissions(user_id, project_id, system_id)
  where system_id is not null and credential_id is null;

create unique index if not exists detailed_permissions_user_project_system_credential_idx
  on public.detailed_permissions(user_id, project_id, system_id, credential_id)
  where system_id is not null and credential_id is not null;
