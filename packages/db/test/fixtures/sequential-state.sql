-- Disposable test database only. Not a production migration; no production tables are required.
create table seq_test_marker (version text primary key check (version = 'SEQ_DISPOSABLE_V1'));
insert into seq_test_marker values ('SEQ_DISPOSABLE_V1');
create table seq_states (
  account_id text not null,
  round_id text not null,
  revision bigint not null check (revision >= 0),
  initial_document jsonb not null,
  initial_hash text not null,
  document jsonb not null,
  state_hash text not null,
  primary key (account_id, round_id)
);
create table seq_trades (
  account_id text not null,
  round_id text not null,
  revision bigint not null check (revision > 0),
  request_key text not null,
  execution_id text not null unique,
  request jsonb not null,
  request_hash text not null,
  before_hash text not null,
  after_hash text not null,
  receipt jsonb not null,
  receipt_hash text not null,
  primary key (account_id, round_id, revision),
  unique (account_id, round_id, request_key),
  foreign key (account_id, round_id) references seq_states(account_id, round_id) on delete restrict
);
create function seq_immutable_trade() returns trigger language plpgsql as $$
begin raise exception 'Experimental transition evidence is immutable'; end $$;
create trigger seq_trade_immutable before update or delete on seq_trades
for each row execute function seq_immutable_trade();
create function seq_initial_immutable() returns trigger language plpgsql as $$
begin
  if old.account_id <> new.account_id or old.round_id <> new.round_id
    or old.initial_document <> new.initial_document or old.initial_hash <> new.initial_hash then
    raise exception 'Initial simulation identity and evidence are immutable';
  end if;
  return new;
end $$;
create trigger seq_initial_immutable before update on seq_states
for each row execute function seq_initial_immutable();
