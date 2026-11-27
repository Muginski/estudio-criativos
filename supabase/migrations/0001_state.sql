-- Espelho de ec_state_v1 (Supabase free). device_id = uuid gerado no aparelho.
create table if not exists public.usage (
  device_id text not null,
  day date not null default current_date,
  prints int not null default 0 check (prints >= 0),
  primary key (device_id, day)
);

create table if not exists public.activations (
  codigo text primary key,
  device_id text,
  days int not null default 30,
  used_at timestamptz,
  until timestamptz
);

alter table public.usage enable row level security;
alter table public.activations enable row level security;

-- anon: lê e escreve só uso de prints; activations sem acesso direto (apenas RPC)
create policy usage_select on public.usage for select to anon using (true);
create policy usage_insert on public.usage for insert to anon with check (prints >= 0);
create policy usage_update on public.usage for update to anon using (true) with check (prints >= 0);

create or replace function public.activate(codigo text, p_device text default null)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare r public.activations;
begin
  select * into r from public.activations a where a.codigo = upper(trim(activate.codigo)) for update;
  if not found then raise exception 'codigo invalido'; end if;
  if r.used_at is not null and r.device_id is distinct from p_device then
    raise exception 'codigo ja utilizado';
  end if;
  if r.used_at is null then
    update public.activations
      set used_at = now(), device_id = p_device, until = now() + (days || ' days')::interval
      where activations.codigo = r.codigo returning * into r;
  end if;
  return r.until;
end $$;

grant execute on function public.activate(text, text) to anon;
