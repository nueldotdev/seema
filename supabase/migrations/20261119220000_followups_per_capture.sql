alter table public.digest_followups rename to capture_followups;
alter table public.capture_followups drop column digest_id;
delete from public.capture_followups f
where not exists (
  select 1 from public.captures c where c.id = f.capture_id
);
alter table public.capture_followups
  add constraint capture_followups_capture_id_fkey
  foreign key (capture_id) references public.captures (id) on delete cascade;

drop policy "Users can read their own digest follow-ups" on public.capture_followups;
drop policy "Users can delete their own digest follow-ups" on public.capture_followups;

create policy "Users can read their own capture follow-ups"
  on public.capture_followups for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can delete their own capture follow-ups"
  on public.capture_followups for delete to authenticated
  using ((select auth.uid()) = user_id);

drop index if exists public.digest_followups_digest_created_idx;
create index capture_followups_capture_created_idx
  on public.capture_followups (capture_id, created_at);

alter table public.captures
  add column followup_count integer not null default 0
  check (followup_count between 0 and 10);

update public.captures c
set followup_count = least(10, (
  select count(*)::integer
  from public.capture_followups f
  where f.capture_id = c.id
));

drop trigger digest_followups_limit on public.capture_followups;
drop function public.enforce_digest_followup_limit();

create or replace function public.enforce_capture_followup_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated_count integer;
begin
  update public.captures
  set followup_count = followup_count + 1
  where id = new.capture_id
    and user_id = new.user_id
    and status = 'researched'
    and result is not null
    and followup_count < 10
  returning followup_count into updated_count;

  if updated_count is null then
    raise exception 'Topic is unavailable or has reached its follow-up limit' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create trigger capture_followups_limit
  before insert on public.capture_followups
  for each row execute function public.enforce_capture_followup_limit();
