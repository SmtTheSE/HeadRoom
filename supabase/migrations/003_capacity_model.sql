-- Capacity model refinements.
-- 1. Load counts remaining effort, not the full estimate: progress from completed
--    step minutes or logged hours, whichever is further along.
-- 2. The calibration multiplier is a median (outlier-resistant), clamped to
--    0.5–3.0, and blended toward 1.0 when fewer than 3 samples exist.
-- 3. After an AI breakdown, the steps are the estimate.
-- The seed's presentation steps total 360 minutes with 40 done, so the sample
-- week starts at a whole number (27 / 30h).

create or replace function public.hr_remaining(w uuid, task_id text) returns numeric
language sql stable set search_path=public as $$
 select greatest(0, least(
   t.personalized_hours - t.actual_hours,
   case when coalesce(s.total,0)>0 then t.personalized_hours*(1 - s.done::numeric/s.total) else t.personalized_hours end))
 from hr_tasks t
 left join (select st.task_id, sum(st.minutes) as total, coalesce(sum(st.minutes) filter (where st.completed),0) as done
            from hr_subtasks st where st.workspace_id=w group by st.task_id) s on s.task_id=t.id
 where t.workspace_id=w and t.id=hr_remaining.task_id;
$$;

create or replace function public.hr_workload(w uuid, employee text, next_week boolean default false) returns numeric
language sql stable set search_path=public as $$
 select coalesce(sum(hr_remaining(w,t.id)),0) from hr_tasks t where t.workspace_id=w and t.employee_id=employee and t.status in ('todo','in_progress')
 and t.deadline < (case when next_week then '2026-10-05T00:00:00+07:00' else '2026-09-28T00:00:00+07:00' end)::timestamptz
 and (not next_week or t.deadline>='2026-09-28T00:00:00+07:00'::timestamptz);
$$;

create or replace function public.hr_multiplier(w uuid, employee text, category_name text) returns numeric
language sql stable set search_path=public as $$
 with valid as(select * from hr_history where workspace_id=w and employee_id=employee and estimated_hours>0 and actual_hours>0),
 chosen as(select actual_hours/estimated_hours as ratio from valid where case when (select count(*) from valid where category=category_name)>=3 then category=category_name else true end order by completed_at desc,id limit 10),
 stats as(select count(*) as n, percentile_cont(0.5) within group (order by ratio) as med from chosen)
 select case when n=0 then 1
        else least(3, greatest(0.5, (least(n,3)*med + (3-least(n,3))*1)/3.0)) end
 from stats;
$$;

create or replace function public.hr_validate_proposal(w uuid, p jsonb) returns void language plpgsql set search_path=public as $$
declare t hr_tasks%rowtype; target hr_profiles%rowtype; amount numeric; date_new timestamptz;
begin
 if p is null or p->>'type' is null or p->>'task_id' is null or p->>'task_version' is null or coalesce(length(p->>'label'),0) not between 1 and 250 then raise exception 'Choose a valid adjustment.'; end if;
 select * into t from hr_tasks where workspace_id=w and id=p->>'task_id';
 if not found or t.employee_id<>'alex' or t.status not in ('todo','in_progress') then raise exception 'This task is no longer available for adjustment.'; end if;
 if t.version<>(p->>'task_version')::integer then raise exception 'This task has changed. Refresh and choose the adjustment again.'; end if;
 if p->>'type'='deadline' then
   date_new := (p->>'deadline')::timestamptz;
   if not t.flexible or date_new is null or date_new<=t.deadline or date_new>='2026-10-05T00:00:00+07:00'::timestamptz then raise exception 'Choose a later deadline within the next week.'; end if;
   if date_new>='2026-09-28T00:00:00+07:00'::timestamptz and hr_workload(w,'alex',true)+hr_remaining(w,t.id)>(select capacity from hr_profiles where workspace_id=w and id='alex') then raise exception 'This would exceed next week''s capacity.'; end if;
 elsif p->>'type'='scope' then
   amount := (p->>'scope_hours')::numeric;
   if amount is null or amount<=0 or amount>t.scope_saving or amount>=t.personalized_hours then raise exception 'The scope reduction is not available.'; end if;
 elsif p->>'type'='reassign' then
   select * into target from hr_profiles where workspace_id=w and id=p->>'employee_id' and id not in ('alex','sarah');
   if not found then raise exception 'Choose an available teammate.'; end if;
   if hr_workload(w,target.id)+t.estimated_hours*hr_multiplier(w,target.id,t.category)>target.capacity then raise exception 'This would exceed the teammate''s capacity.'; end if;
 else raise exception 'Unknown adjustment type.';
 end if;
end;
$$;

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
 -- Steps are now the estimate: the personalized hours equal the step minutes.
 update hr_tasks set personalized_hours=round((select sum(minutes) from hr_subtasks where workspace_id=w and hr_subtasks.task_id=t.id)/60.0,2), version=version+1 where workspace_id=w and id=t.id;
 update hr_workspaces set version=version+1 where id=w;
 return hr_state_json(w);
end;
$$;

create or replace function public.hr_seed(w uuid) returns void language plpgsql set search_path=public as $$
begin
 insert into hr_profiles(workspace_id,id,name,job_title,manager_id,capacity) values
 (w,'alex','Alex Morgan','UX Designer','sarah',30),(w,'maya','Maya Chen','Researcher','sarah',28),
 (w,'jordan','Jordan Lee','Designer','sarah',30),(w,'sam','Sam Patel','Developer','sarah',32),(w,'sarah','Sarah Lee','Design Manager',null,30);
 insert into hr_tasks(workspace_id,id,employee_id,title,description,category,priority,status,deadline,estimated_hours,personalized_hours,multiplier,scope_saving) values
 (w,'presentation','alex','Client Presentation','Bring the client up to speed on our findings and the next iteration. Review the analytics, tell a clear story, and leave room for discussion.','Presentation','High','in_progress','2026-09-25T08:00:00Z',8,9,1.125,2),
 (w,'research','alex','Competitor Research','Compare onboarding experiences across three competitors. Summarize opportunities for our next design sprint.','Research','High','todo','2026-09-24T10:00:00Z',6,7,7.0/6,0),
 (w,'testing','alex','Prototype Testing','Run the prepared usability sessions and collect observations for the product team.','Testing','Medium','todo','2026-09-25T07:00:00Z',4,5,1.25,0),
 (w,'analytics','alex','Analytics Report','Summarize activation and engagement trends. The team has confirmed this deadline is flexible.','Analytics','Medium','todo','2026-09-23T10:00:00Z',5,6,1.2,0),
 (w,'review','alex','Design Review','Review the updated components with the design team.','Design','Low','todo','2026-09-25T09:00:00Z',1,1,1,0),
 (w,'new-research','alex','Client Competitor Research','A new request from the client: investigate competitor positioning before the next strategy meeting.','Research','High','draft','2026-09-24T10:00:00Z',6,7,7.0/6,0),
 (w,'maya-work','maya','Customer discovery synthesis','Combine interviews into actionable research findings.','Research','Medium','todo','2026-09-25T10:00:00Z',18,18,1,0),
 (w,'jordan-work','jordan','Design system improvements','Improve the product component library.','Design','Medium','todo','2026-09-25T10:00:00Z',26,26,1,0),
 (w,'sam-work','sam','Product engineering sprint','Implement the next product iteration.','Design','High','todo','2026-09-25T10:00:00Z',29,29,1,0);
 insert into hr_subtasks(workspace_id,id,task_id,title,completed,minutes,position) values
 (w,'presentation-0','presentation','Review analytics with John',true,20,0),(w,'presentation-1','presentation','Collect relevant data',true,20,1),
 (w,'presentation-2','presentation','Draft presentation',false,130,2),(w,'presentation-3','presentation','Add visuals',false,100,3),
 (w,'presentation-4','presentation','Review slides',false,50,4),(w,'presentation-5','presentation','Finalize and send',false,40,5),
 (w,'research-0','research','Choose three competitors',false,30,0),(w,'research-1','research','Compare onboarding flows',false,90,1),(w,'research-2','research','Summarize opportunities',false,60,2);
 insert into hr_history(workspace_id,id,employee_id,category,estimated_hours,actual_hours,completed_at)
 select w,'history-'||v.category||'-'||n,'alex',v.category,v.estimated,v.actual,('2026-09-18T10:00:00Z'::timestamptz-n*interval '1 day')
 from (values ('Presentation',8,9),('Research',6,7),('Testing',4,5),('Analytics',5,6),('Design',1,1)) as v(category,estimated,actual) cross join generate_series(0,2) n;
end;
$$;

revoke all on function public.hr_remaining(uuid,text) from public,anon,authenticated;
revoke all on function public.hr_seed(uuid) from public,anon,authenticated;
revoke all on function public.hr_multiplier(uuid,text,text) from public,anon,authenticated;
revoke all on function public.hr_workload(uuid,text,boolean) from public,anon,authenticated;
revoke all on function public.hr_validate_proposal(uuid,jsonb) from public,anon,authenticated;
revoke all on function public.headroom_breakdown(text,jsonb,integer) from public,anon;
grant execute on function public.headroom_breakdown(text,jsonb,integer) to authenticated;
