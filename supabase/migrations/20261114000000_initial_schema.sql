create extension if not exists pgcrypto;

create table public.settings (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  preset_context text not null default 'Explain simply and clearly, using a warm and encouraging tone.',
  delivery_time time not null default '07:00',
  timezone text not null default 'Africa/Lagos',
  updated_at timestamptz not null default now()
);

create table public.digests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  digest_date date not null,
  content jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  emailed_at timestamptz,
  opened_at timestamptz,
  reminder_sent_at timestamptz,
  status text not null default 'processing' check (status in ('processing', 'ready', 'failed')),
  unique (user_id, digest_date)
);

create table public.captures (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  text text not null check (char_length(text) between 1 and 2000),
  created_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'researched', 'failed')),
  result jsonb,
  digest_id uuid references public.digests (id) on delete set null
);

create index captures_user_created_idx on public.captures (user_id, created_at);
create index digests_unopened_email_idx on public.digests (emailed_at) where opened_at is null and reminder_sent_at is null;

alter table public.settings enable row level security;
alter table public.captures enable row level security;
alter table public.digests enable row level security;

create policy "Users can read their own settings" on public.settings for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users can create their own settings" on public.settings for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users can update their own settings" on public.settings for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy "Users can read their own captures" on public.captures for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users can create their own captures" on public.captures for insert to authenticated
with check ((select auth.uid()) = user_id and status = 'pending' and result is null and digest_id is null);

create policy "Users can read their own digests" on public.digests for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users can mark their own digests as opened" on public.digests for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id and opened_at is not null);

grant select, insert, update on public.settings to authenticated;
grant select, insert on public.captures to authenticated;
grant select on public.digests to authenticated;
grant update (opened_at) on public.digests to authenticated;

create or replace function public.touch_settings_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger settings_updated_at before update on public.settings
for each row execute function public.touch_settings_updated_at();

create or replace function public.create_default_settings()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.settings (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
for each row execute function public.create_default_settings();

-- Schedule the functions after adding project_url and cron_secret to Vault.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'seema-run-daily',
  '*/15 * * * *',
  $job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/run-daily',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
      ),
      body := '{}'::jsonb
    );
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/send-reminders',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
      ),
      body := '{}'::jsonb
    );
  $job$
);
