-- Applied ONLY to the fresh Docker test database by disposable.ts. Not a production migration.
create schema private_v2;
create table private_v2.isolation_guard (singleton boolean primary key default true check(singleton), token text not null);
create table private_v2.round_models (
  round_id text primary key references hourly_rounds(id),
  model_version text not null,
  policy_hash text not null
);
create function private_v2.freeze_model() returns trigger language plpgsql as $$
begin raise exception 'PRIVATE_MODEL_BINDING_IMMUTABLE'; end $$;
create trigger frozen_model before update or delete on private_v2.round_models
for each row execute function private_v2.freeze_model();
create table private_v2.position_peaks (
  position_id text primary key references positions(id),
  peak_quantity bigint not null check(peak_quantity>=0)
);
create function private_v2.track_peak() returns trigger language plpgsql as $$
begin
  if new.status='CLOSED' then
    insert into private_v2.position_peaks values(new.id,0)
    on conflict(position_id) do update set peak_quantity=0;
  elsif tg_op='INSERT' then
    insert into private_v2.position_peaks values(new.id,new.remaining_base_units);
  elsif old.status='CLOSED' then
    insert into private_v2.position_peaks values(new.id,new.remaining_base_units)
    on conflict(position_id) do update set peak_quantity=excluded.peak_quantity;
  else
    insert into private_v2.position_peaks values(new.id,new.remaining_base_units)
    on conflict(position_id) do update set peak_quantity=greatest(private_v2.position_peaks.peak_quantity,excluded.peak_quantity);
  end if;
  return new;
end $$;
create trigger private_peak after insert or update on positions
for each row execute function private_v2.track_peak();
create function private_v2.guard_fill_model() returns trigger language plpgsql as $$
declare expected text;
begin
  select rm.model_version into expected from orders o join competition_accounts ca on ca.id=o.competition_account_id
    join private_v2.round_models rm on rm.round_id=ca.hourly_round_id where o.id=new.order_id;
  if expected is null or new.adapter_version is distinct from expected then
    raise exception 'PRIVATE_MODEL_VERSION_MISMATCH';
  end if;
  return new;
end $$;
create trigger private_fill_model before insert on fills
for each row execute function private_v2.guard_fill_model();
create table private_v2.settlement_control (
  round_id text primary key references hourly_rounds(id),
  attempts integer not null default 0,
  status text not null default 'RETRY_PENDING',
  failures jsonb not null default '[]'
);
