create table public.digest_followups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  digest_id uuid not null references public.digests (id) on delete cascade,
  capture_id uuid not null,
  question text not null check (char_length(btrim(question)) between 1 and 1000),
  answer text not null check (char_length(btrim(answer)) between 1 and 6000),
  created_at timestamptz not null default now()
);

create index digest_followups_digest_created_idx
  on public.digest_followups (digest_id, created_at);

alter table public.digest_followups enable row level security;

create policy "Users can read their own digest follow-ups"
  on public.digest_followups for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can delete their own digest follow-ups"
  on public.digest_followups for delete to authenticated
  using ((select auth.uid()) = user_id);

grant select, delete on public.digest_followups to authenticated;

create policy "Users can delete their own captures"
  on public.captures for delete to authenticated
  using ((select auth.uid()) = user_id);

grant delete on public.captures to authenticated;

create or replace function public.enforce_digest_followup_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  digest_user_id uuid;
  digest_content jsonb;
  followup_count integer;
begin
  select d.user_id, d.content into digest_user_id, digest_content
  from public.digests d
  where d.id = new.digest_id and d.status = 'ready'
  for update;

  if digest_user_id is null or digest_user_id <> new.user_id then
    raise exception 'Digest is unavailable for follow-ups' using errcode = 'P0001';
  end if;

  if not exists (
    select 1
    from jsonb_array_elements(coalesce(digest_content, '[]'::jsonb)) as topic(value)
    where topic.value->>'id' = new.capture_id::text
  ) then
    raise exception 'Topic does not belong to this digest' using errcode = 'P0001';
  end if;

  select count(*) into followup_count
  from public.digest_followups f
  where f.digest_id = new.digest_id;

  if followup_count >= 10 then
    raise exception 'Digest follow-up limit reached' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create trigger digest_followups_limit
  before insert on public.digest_followups
  for each row execute function public.enforce_digest_followup_limit();
