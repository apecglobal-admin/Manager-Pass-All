alter table public.projects
  add column if not exists sort_order integer not null default 0;

alter table public.project_systems
  add column if not exists sort_order integer not null default 0;

create index if not exists idx_projects_sort_order on public.projects(sort_order, name);
create index if not exists idx_project_systems_project_sort_order on public.project_systems(project_id, sort_order, name);
