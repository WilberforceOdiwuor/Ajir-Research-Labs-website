-- Applied through Supabase's migration API. All processing state is private.
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;
create schema if not exists waitlist_ops;
revoke all on schema waitlist_ops from public, anon, authenticated;
grant usage on schema waitlist_ops to service_role;

create table waitlist_ops.config (
  id boolean primary key default true check (id),
  settings jsonb not null
);
alter table waitlist_ops.config enable row level security;
create table waitlist_ops.jobs (
  id uuid primary key default gen_random_uuid(),
  dedup_key text not null unique,
  kind text not null check (kind in ('sync','welcome','alert','digest','test')),
  signup_id uuid references public.waitlist_signups(id) on delete cascade,
  payload jsonb not null default '{}',
  state text not null default 'pending' check (state in ('pending','processing','done','failed')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  lease_id uuid,
  locked_until timestamptz,
  first_send_at timestamptz,
  result jsonb,
  last_error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
alter table waitlist_ops.jobs enable row level security;
create index waitlist_brevo_pending on waitlist_ops.jobs(available_at) where state in ('pending','processing');
grant select, insert, update, delete on all tables in schema waitlist_ops to service_role;

-- Generated and kept inside Vault; never copied into source code or output.
do $$
declare worker_token text := encode(extensions.gen_random_bytes(32),'hex');
begin
  perform vault.create_secret(worker_token, 'waitlist_brevo_worker_token', 'Internal waitlist worker authentication');
  insert into waitlist_ops.config(settings) values(jsonb_build_object(
    'worker_token_hash',encode(extensions.digest(worker_token,'sha256'),'hex'),
    'active',false,'sender_email','contact@ajirresearch.com','sender_name','Ajir Research Labs',
    'alert_recipients','[]'::jsonb -- Configure private recipients through waitlist_brevo_save_config before activation.
  ));
end $$;

create function public.waitlist_brevo_config() returns jsonb
language sql security invoker set search_path='' as $$
  select settings from waitlist_ops.config where id;
$$;
create function public.waitlist_brevo_save_config(p_patch jsonb) returns void
language sql security invoker set search_path='' as $$
  update waitlist_ops.config set settings=settings || p_patch where id;
$$;
create function public.waitlist_brevo_signup(p_id uuid) returns jsonb
language sql security invoker set search_path='' as $$
  select to_jsonb(s) from public.waitlist_signups s where s.id=p_id;
$$;

create function waitlist_ops.enqueue_signup() returns trigger
language plpgsql security invoker set search_path='' as $$
declare recipient text;
begin
  if TG_OP='UPDATE' and new.email=old.email and new.newsletter_opt_in=old.newsletter_opt_in
    and new.source=old.source and new.status=old.status then return new; end if;
  insert into waitlist_ops.jobs(dedup_key,kind,signup_id)
    values('sync:'||new.id||':'||new.updated_at,'sync',new.id) on conflict do nothing;
  if TG_OP='INSERT' then
    insert into waitlist_ops.jobs(dedup_key,kind,signup_id)
      values('welcome:'||new.id,'welcome',new.id) on conflict do nothing;
    for recipient in select jsonb_array_elements_text(settings->'alert_recipients') from waitlist_ops.config where id loop
      insert into waitlist_ops.jobs(dedup_key,kind,signup_id,payload)
        values('alert:'||new.id||':'||recipient,'alert',new.id,jsonb_build_object('recipient',recipient)) on conflict do nothing;
    end loop;
  end if;
  return new;
end $$;
create trigger waitlist_brevo_enqueue after insert or update on public.waitlist_signups
for each row execute function waitlist_ops.enqueue_signup();

create function public.waitlist_brevo_claim(p_limit integer default 1) returns setof waitlist_ops.jobs
language sql security invoker set search_path='' as $$
  update waitlist_ops.jobs j set state='processing',locked_until=now()+interval '3 minutes',
    lease_id=gen_random_uuid(),attempts=j.attempts+1
  where j.id in (
    select q.id from waitlist_ops.jobs q
    where q.available_at<=now() and (q.state='pending' or (q.state='processing' and q.locked_until<now()))
    order by case when q.kind='sync' then 0 else 1 end,q.available_at,q.created_at
    limit least(greatest(p_limit,1),10) for update skip locked
  ) returning j.*;
$$;
create function public.waitlist_brevo_finish(p_id uuid,p_lease uuid,p_state text,p_result jsonb default null,
  p_error text default null,p_delay integer default 60,p_reset_send boolean default false) returns void
language sql security invoker set search_path='' as $$
  update waitlist_ops.jobs set state=p_state,result=p_result,last_error=p_error,
    available_at=now()+make_interval(secs=>greatest(p_delay,10)),locked_until=null,
    first_send_at=case when p_reset_send then null else first_send_at end,
    completed_at=case when p_state in ('done','failed') then now() else null end
  where id=p_id and lease_id=p_lease and state='processing';
$$;
create function public.waitlist_brevo_mark_send(p_id uuid,p_lease uuid) returns timestamptz
language sql security invoker set search_path='' as $$
  update waitlist_ops.jobs set first_send_at=coalesce(first_send_at,now())
  where id=p_id and lease_id=p_lease and state='processing' returning first_send_at;
$$;
create function public.waitlist_brevo_event(p_email text,p_event text,p_message_id text default null,p_scope text default 'all') returns void
language plpgsql security invoker set search_path='' as $$
begin
  if p_message_id is not null then
    update waitlist_ops.jobs set result=coalesce(result,'{}') || jsonb_build_object('delivery_event',p_event,'event_at',now())
      where trim(result->>'messageId','<>')=trim(p_message_id,'<>');
  end if;
  if p_event in ('hard_bounce','hardBounce','invalid') then
    update public.waitlist_signups set status='bounced',newsletter_opt_in=false
      where email=lower(p_email) and (status<>'bounced' or newsletter_opt_in);
  elsif p_event in ('unsubscribed','spam') then
    update public.waitlist_signups set
      status=case when p_scope in ('all','waitlist') then 'unsubscribed' else status end,
      newsletter_opt_in=case when p_scope in ('all','newsletter') then false else newsletter_opt_in end
    where email=lower(p_email) and (
      (p_scope in ('all','waitlist') and status<>'unsubscribed') or
      (p_scope in ('all','newsletter') and newsletter_opt_in));
  end if;
end $$;

create function public.waitlist_brevo_enqueue_digest(p_day date default ((now() at time zone 'Africa/Nairobi')::date-1)) returns void
language plpgsql security invoker set search_path='' as $$
declare summary jsonb; recipient text;
begin
  select jsonb_build_object('day',p_day,'new_signups',count(*),'newsletter_opt_ins',count(*) filter(where newsletter_opt_in),
    'total_signups',(select count(*) from public.waitlist_signups),
    'waiting',(select count(*) from public.waitlist_signups where status='pending'),
    'failed_jobs',(select count(*) from waitlist_ops.jobs where state='failed'),
    'pending_jobs',(select count(*) from waitlist_ops.jobs where state in ('pending','processing')),
    'sources',(select coalesce(jsonb_object_agg(source,n),'{}') from (
      select source,count(*) n from public.waitlist_signups
      where created_at>=p_day::timestamp at time zone 'Africa/Nairobi'
      and created_at<(p_day+1)::timestamp at time zone 'Africa/Nairobi' group by source) x)) into summary
  from public.waitlist_signups where created_at>=p_day::timestamp at time zone 'Africa/Nairobi'
    and created_at<(p_day+1)::timestamp at time zone 'Africa/Nairobi';
  for recipient in select jsonb_array_elements_text(settings->'alert_recipients') from waitlist_ops.config where id loop
    insert into waitlist_ops.jobs(dedup_key,kind,payload)
      values('digest:'||p_day||':'||recipient,'digest',summary||jsonb_build_object('recipient',recipient)) on conflict do nothing;
  end loop;
end $$;
create function public.waitlist_brevo_backfill() returns void
language sql security invoker set search_path='' as $$
  insert into waitlist_ops.jobs(dedup_key,kind,signup_id)
    select 'backfill:'||id,'sync',id from public.waitlist_signups on conflict do nothing;
$$;
create function public.waitlist_brevo_test() returns void
language sql security invoker set search_path='' as $$
  insert into waitlist_ops.jobs(dedup_key,kind,payload)
    select 'setup-test:'||recipient,'test',jsonb_build_object('recipient',recipient)
    from waitlist_ops.config,jsonb_array_elements_text(settings->'alert_recipients') recipient
    on conflict do nothing;
$$;
create function public.waitlist_brevo_status() returns jsonb
language sql security invoker set search_path='' as $$
  select jsonb_build_object('jobs',coalesce((select jsonb_agg(x) from (
    select kind,state,count(*) from waitlist_ops.jobs group by kind,state) x),'[]'),
    'failures',coalesce((select jsonb_agg(x) from (
      select kind,last_error,attempts from waitlist_ops.jobs where state='failed' limit 10)x),'[]'));
$$;
create function waitlist_ops.invoke(p_action text default 'process') returns bigint
language sql security invoker set search_path='' as $$
  select net.http_post(
    url:='https://zrtvvbnpmgyjebkhunes.supabase.co/functions/v1/waitlist-brevo',
    headers:=jsonb_build_object('Content-Type','application/json','X-Worker-Token',
      (select decrypted_secret from vault.decrypted_secrets where name='waitlist_brevo_worker_token')),
    body:=jsonb_build_object('action',p_action),timeout_milliseconds:=60000);
$$;

-- RPCs are only callable by the backend service role; public users cannot list subscribers or run jobs.
do $$
declare f record;
begin
  for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname like 'waitlist_brevo_%' loop
    execute 'revoke all on function '||f.signature||' from public,anon,authenticated';
    execute 'grant execute on function '||f.signature||' to service_role';
  end loop;
end $$;
revoke all on all functions in schema waitlist_ops from public,anon,authenticated;
grant execute on function waitlist_ops.enqueue_signup() to service_role;
-- Schedules are enabled separately, after setup and delivery tests succeed.
