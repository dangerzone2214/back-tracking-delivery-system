create table if not exists sheet_links (
  id bigserial primary key,
  year integer not null,
  month integer not null check (month between 1 and 12),
  url text not null,
  sheet_name text,
  status text not null default 'No link',
  last_sync timestamptz,
  imported_records integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (year, month)
);

create table if not exists delivery_records (
  id text primary key,
  year integer not null,
  month integer not null check (month between 1 and 12),
  sheet_key text not null,
  row_number integer not null,
  creator_code text,
  waybill_number text,
  order_status text,
  signing_time text,
  receiver text,
  receiver_cellphone text,
  submission_time text,
  remarks text,
  sender_name text,
  normalized_status text not null default 'other',
  order_date date,
  amount numeric(12, 2) not null default 0,
  search_text text not null default '',
  search_digits text not null default '',
  raw jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now()
);

create index if not exists idx_delivery_year_month on delivery_records (year, month);
create index if not exists idx_delivery_status on delivery_records (normalized_status);
create index if not exists idx_delivery_sheet_key on delivery_records (sheet_key);
create index if not exists idx_delivery_search_digits on delivery_records (search_digits);
create index if not exists idx_delivery_waybill on delivery_records (waybill_number);
create index if not exists idx_delivery_receiver_cellphone on delivery_records (receiver_cellphone);

create table if not exists agent_accounts (
  id bigserial primary key,
  username text not null unique,
  password_hash text not null,
  salt text not null,
  role text not null default 'agent',
  active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists agent_login_events (
  id bigserial primary key,
  agent_id bigint references agent_accounts(id) on delete set null,
  username text not null,
  role text not null default 'agent',
  ip_address text,
  user_agent text,
  logged_in_at timestamptz not null default now()
);

create index if not exists idx_agent_login_events_agent on agent_login_events (agent_id);
create index if not exists idx_agent_login_events_time on agent_login_events (logged_in_at desc);
