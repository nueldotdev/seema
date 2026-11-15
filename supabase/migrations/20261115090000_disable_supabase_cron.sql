do $$
declare
  scheduled_job record;
begin
  for scheduled_job in
    select jobid
    from cron.job
    where jobname = 'seema-run-daily'
  loop
    perform cron.unschedule(scheduled_job.jobid);
  end loop;
end;
$$;
