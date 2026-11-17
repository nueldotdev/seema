alter table public.settings
  add column email_enabled boolean not null default true;

alter table public.digests
  add column email_skipped_at timestamptz;

create table public.user_suggestions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  suggestion text not null check (char_length(btrim(suggestion)) between 1 and 3000),
  created_at timestamptz not null default now()
);

alter table public.user_suggestions enable row level security;

create policy "Users can submit their own suggestions"
  on public.user_suggestions
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

grant insert on public.user_suggestions to authenticated;
