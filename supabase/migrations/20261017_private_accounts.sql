begin;

create table public.peps_private_vaults (
  user_id uuid primary key references auth.users(id) on delete cascade,
  format integer not null default 1 check (format = 1),
  password_wrap jsonb not null check (jsonb_typeof(password_wrap) = 'object'),
  recovery_wrap jsonb not null check (jsonb_typeof(recovery_wrap) = 'object'),
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 5242880),
  revision bigint not null default 1,
  updated_at timestamptz not null default now()
);
alter table public.peps_private_vaults enable row level security;
revoke all on public.peps_private_vaults from public, anon, authenticated;
grant select on public.peps_private_vaults to authenticated;
grant insert (user_id, format, password_wrap, recovery_wrap, payload) on public.peps_private_vaults to authenticated;
grant update (password_wrap, recovery_wrap, payload) on public.peps_private_vaults to authenticated;

create policy peps_own_vault_select on public.peps_private_vaults
  for select to authenticated using ((select auth.uid()) = user_id);
create policy peps_own_vault_insert on public.peps_private_vaults
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy peps_own_vault_update on public.peps_private_vaults
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create function public.peps_bump_vault_revision() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.revision := old.revision + 1;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.peps_bump_vault_revision() from public;
create trigger peps_vault_revision before update on public.peps_private_vaults
  for each row execute function public.peps_bump_vault_revision();

-- Only an administrator can bind an existing encrypted profile to an Auth user.
-- Never infer ownership from a display name or user-editable metadata.
create table public.peps_legacy_owners (
  user_id uuid primary key references auth.users(id) on delete cascade,
  legacy_id text not null unique references public.peptide_calendar_sync(id)
);
alter table public.peps_legacy_owners enable row level security;
revoke all on public.peps_legacy_owners from public, anon, authenticated;

-- Reserve ownership before sending an invitation, so immediate acceptance cannot
-- accidentally create an empty account. Only administrators can write reservations.
create table public.peps_legacy_reservations (
  email text primary key check (email = lower(btrim(email)) and email <> ''),
  legacy_id text not null unique references public.peptide_calendar_sync(id)
);
alter table public.peps_legacy_reservations enable row level security;
revoke all on public.peps_legacy_reservations from public, anon, authenticated;

create function public.peps_read_legacy_vault() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  current_user_id uuid := auth.uid();
  reserved_legacy_id text;
begin
  if current_user_id is null then
    return null;
  end if;

  if not exists (select 1 from public.peps_legacy_owners where user_id = current_user_id) then
    delete from public.peps_legacy_reservations
    where email = (
      select lower(account.email) from auth.users as account
      where account.id = current_user_id and account.email_confirmed_at is not null
    )
    returning legacy_id into reserved_legacy_id;

    if found then
      insert into public.peps_legacy_owners (user_id, legacy_id)
      values (current_user_id, reserved_legacy_id);
    end if;
  end if;

  return (
    select jsonb_build_object('salt', legacy.salt, 'iv', legacy.iv, 'ciphertext', legacy.ciphertext)
    from public.peps_legacy_owners as owner
    join public.peptide_calendar_sync as legacy on legacy.id = owner.legacy_id
    where owner.user_id = current_user_id
  );
end;
$$;
revoke all on function public.peps_read_legacy_vault() from public, anon;
grant execute on function public.peps_read_legacy_vault() to authenticated;

commit;
