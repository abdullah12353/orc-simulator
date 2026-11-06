-- Table the hook/ catcher writes webhook deliveries into (signin.mjs reads link_url from it).
create table if not exists probe_hooks (id bigserial primary key, at timestamptz default now(), method text, path text, headers jsonb, body text);
