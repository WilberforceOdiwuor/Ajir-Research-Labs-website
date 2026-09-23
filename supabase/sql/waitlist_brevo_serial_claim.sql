-- Serialize claims so consent syncs and email jobs cannot overtake one another.
create or replace function public.waitlist_brevo_claim(p_limit integer default 1) returns setof waitlist_ops.jobs
language plpgsql security invoker set search_path='' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('ajir-waitlist-brevo-claim',0));
  if exists(select 1 from waitlist_ops.jobs where state='processing' and locked_until>now()) then return; end if;
  return query update waitlist_ops.jobs j set state='processing',locked_until=now()+interval '3 minutes',
    lease_id=gen_random_uuid(),attempts=j.attempts+1
  where j.id in (
    select q.id from waitlist_ops.jobs q
    where q.available_at<=now() and (q.state='pending' or (q.state='processing' and q.locked_until<now()))
    order by case when q.kind='sync' then 0 else 1 end,q.available_at,q.created_at
    limit least(greatest(p_limit,1),10) for update skip locked
  ) returning j.*;
end $$;
revoke all on function public.waitlist_brevo_claim(integer) from public,anon,authenticated;
grant execute on function public.waitlist_brevo_claim(integer) to service_role;
