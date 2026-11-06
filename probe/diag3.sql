-- Does a policy that calls auth.uid() inline work for the authenticated role?
drop table if exists probe_inline;
create table probe_inline (user_id uuid primary key, note text);
alter table probe_inline enable row level security;
create policy mine on probe_inline for select to authenticated using (user_id = auth.uid());
grant select on probe_inline to authenticated;
insert into probe_inline select id, email from neon_auth."user";
