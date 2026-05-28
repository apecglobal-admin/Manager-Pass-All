create table if not exists public.project_memberships (
  user_id uuid not null references public.app_users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, project_id)
);

create table if not exists public.detailed_permissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  entry_type_id uuid not null references public.entry_types(id) on delete cascade,
  can_view_entry boolean not null default false,
  can_view_url boolean not null default false,
  can_view_username boolean not null default false,
  can_reveal_password boolean not null default false,
  can_view_notes boolean not null default false,
  can_create boolean not null default false,
  can_edit boolean not null default false,
  can_delete boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, project_id, entry_type_id)
);
