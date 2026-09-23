-- pg_cron runs in GMT/UTC; 05:00 UTC is 08:00 Africa/Nairobi.
select cron.schedule('ajir-waitlist-brevo-worker','* * * * *',$job$
  select waitlist_ops.invoke('process')
  where (select (settings->>'active')::boolean from waitlist_ops.config where id)
    and exists(select 1 from waitlist_ops.jobs where available_at<=now()
      and (state='pending' or (state='processing' and locked_until<now())));
$job$);
select cron.schedule('ajir-waitlist-brevo-digest','0 5 * * *',$job$
  select public.waitlist_brevo_enqueue_digest()
  where (select (settings->>'active')::boolean from waitlist_ops.config where id);
$job$);
