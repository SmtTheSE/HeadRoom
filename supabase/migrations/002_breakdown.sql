-- AI breakdown: persist generated steps for a task that has none yet.
-- Steps are validated here; the caller (edge function or offline planner) only suggests them.
create or replace function public.headroom_breakdown(task_id text, steps jsonb, expected_version integer) returns jsonb
language plpgsql security definer set search_path=public as $$
declare w uuid; v integer; t hr_tasks%rowtype; s jsonb; i integer := 0; n integer; m integer;
begin
 if auth.uid() is null then raise exception 'Please sign in to save changes.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 select id,version into w,v from hr_workspaces where owner_id=auth.uid() for update;
 if w is null then raise exception 'Open the workspace before making changes.'; end if;
 if expected_version is null or v<>expected_version then raise exception 'Your workspace has changed. Refresh before trying again.'; end if;
 select * into t from hr_tasks where workspace_id=w and id=headroom_breakdown.task_id;
 if not found or t.employee_id<>'alex' or t.status not in ('todo','in_progress') then raise exception 'This task cannot be broken down.'; end if;
 if exists(select 1 from hr_subtasks where workspace_id=w and hr_subtasks.task_id=t.id) then raise exception 'This task already has steps.'; end if;
 if steps is null or jsonb_typeof(steps)<>'array' then raise exception 'Provide a list of steps.'; end if;
 n := jsonb_array_length(steps);
 if n<2 or n>8 then raise exception 'Provide between 2 and 8 steps.'; end if;
 for s in select * from jsonb_array_elements(steps) loop
   i := i+1;
   m := nullif(s->>'minutes','')::integer;
   if length(trim(coalesce(s->>'title',''))) not between 1 and 120 or m is null or m not between 5 and 480 then
     raise exception 'Each step needs a title and between 5 and 480 minutes.';
   end if;
   insert into hr_subtasks(workspace_id,id,task_id,title,completed,minutes,position)
   values(w, t.id||'-step-'||i||'-'||substr(gen_random_uuid()::text,1,8), t.id, trim(s->>'title'), false, m, i);
 end loop;
 update hr_tasks set version=version+1 where workspace_id=w and id=t.id;
 update hr_workspaces set version=version+1 where id=w;
 return hr_state_json(w);
end;
$$;
revoke all on function public.headroom_breakdown(text,jsonb,integer) from public,anon;
grant execute on function public.headroom_breakdown(text,jsonb,integer) to authenticated;
