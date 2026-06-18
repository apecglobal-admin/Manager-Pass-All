-- 1. One-time update: Sync all existing account (entry) names with their corresponding system names
update public.entries e
set 
  name = s.name,
  updated_at = now()
from public.project_systems s
where e.system_id = s.id;

-- 2. Create trigger function to automatically sync entry name when system name is updated
create or replace function public.sync_entry_name_on_system_rename()
returns trigger as $$
begin
  if old.name <> new.name then
    update public.entries
    set 
      name = new.name,
      updated_at = now()
    where system_id = new.id;
  end if;
  return new;
end;
$$ language plpgsql security definer;

-- 3. Create trigger on project_systems table
drop trigger if exists trg_sync_entry_name_on_system_rename on public.project_systems;
create trigger trg_sync_entry_name_on_system_rename
  after update of name on public.project_systems
  for each row
  execute function public.sync_entry_name_on_system_rename();
