-- Headroom: isolated synthetic demo workspaces owned by Supabase Auth users.
-- Run this entire file once in the Supabase SQL Editor.
begin;
create table if not exists public.hr_workspaces (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null unique references auth.users(id) on delete cascade,
 version integer not null default 1, demo_date date not null default '2026-09-23', created_at timestamptz default now()
);
create table if not exists public.hr_profiles (
 workspace_id uuid not null references public.hr_workspaces(id) on delete cascade, id text not null,
 name text not null, job_title text not null, manager_id text, capacity numeric not null check(capacity>0), weekly_hours numeric not null default 40,
 primary key(workspace_id,id)
);
create table if not exists public.hr_tasks (
 workspace_id uuid not null references public.hr_workspaces(id) on delete cascade, id text not null,
 employee_id text not null, title text not null, description text not null default '', category text not null,
 priority text not null check(priority in ('High','Medium','Low')), status text not null check(status in ('draft','todo','in_progress','completed','cancelled')),
 deadline timestamptz not null, estimated_hours numeric not null check(estimated_hours>0), personalized_hours numeric not null check(personalized_hours>=0),
 actual_hours numeric not null default 0 check(actual_hours>=0), multiplier numeric not null check(multiplier>0),
 flexible boolean not null default true, scope_saving numeric not null default 0 check(scope_saving>=0), version integer not null default 1,
 assigned_by text not null default 'sarah', primary key(workspace_id,id),
 foreign key(workspace_id,employee_id) references public.hr_profiles(workspace_id,id)
);
create table if not exists public.hr_subtasks (
 workspace_id uuid not null, id text not null, task_id text not null, title text not null,
 completed boolean not null default false, minutes integer not null check(minutes>0), position integer not null,
 primary key(workspace_id,id), foreign key(workspace_id,task_id) references public.hr_tasks(workspace_id,id) on delete cascade
);
create table if not exists public.hr_history (
 workspace_id uuid not null references public.hr_workspaces(id) on delete cascade, id text not null, employee_id text not null,
 task_id text, category text not null, estimated_hours numeric not null check(estimated_hours>0), actual_hours numeric not null check(actual_hours>0),
 completed_at timestamptz not null default now(), primary key(workspace_id,id), unique(workspace_id,task_id)
);
create table if not exists public.hr_dependencies (
 workspace_id uuid not null, task_id text not null, prerequisite_id text not null, primary key(workspace_id,task_id,prerequisite_id),
 foreign key(workspace_id,task_id) references public.hr_tasks(workspace_id,id) on delete cascade,
 foreign key(workspace_id,prerequisite_id) references public.hr_tasks(workspace_id,id) on delete cascade, check(task_id<>prerequisite_id)
);
create table if not exists public.hr_negotiations (
 workspace_id uuid not null references public.hr_workspaces(id) on delete cascade, id text not null default gen_random_uuid()::text,
 employee_id text not null default 'alex', manager_id text not null default 'sarah', trigger_task_id text not null default 'new-research',
 status text not null check(status in ('pending','counter_proposed','approved','declined','cancelled')),
 revision integer not null default 1, proposal jsonb not null, workload_snapshot numeric not null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), primary key(workspace_id,id)
);
create unique index if not exists hr_one_open_request on public.hr_negotiations(workspace_id,employee_id) where status in ('pending','counter_proposed');
create table if not exists public.hr_proposals (
 workspace_id uuid not null, negotiation_id text not null, revision integer not null, author text not null,
 proposal jsonb not null, created_at timestamptz not null default now(), primary key(workspace_id,negotiation_id,revision),
 foreign key(workspace_id,negotiation_id) references public.hr_negotiations(workspace_id,id) on delete cascade
);
create table if not exists public.hr_messages (
 workspace_id uuid not null, id text not null default gen_random_uuid()::text, negotiation_id text not null,
 author text not null check(author in ('employee','manager')), body text not null check(length(body) between 1 and 4000), revision integer not null,
 created_at timestamptz not null default now(), primary key(workspace_id,id),
 foreign key(workspace_id,negotiation_id) references public.hr_negotiations(workspace_id,id) on delete cascade
);
create index if not exists hr_tasks_deadlines on public.hr_tasks(workspace_id,employee_id,deadline);
create index if not exists hr_requests_status on public.hr_negotiations(workspace_id,status);

-- Internal helpers are not callable by browser roles.
create or replace function public.hr_multiplier(w uuid, employee text, category_name text) returns numeric
language sql stable set search_path=public as $$
 with valid as(select * from hr_history where workspace_id=w and employee_id=employee and estimated_hours>0 and actual_hours>0),
 chosen as(select * from valid where case when (select count(*) from valid where category=category_name)>=3 then category=category_name else true end order by completed_at desc,id limit 10)
 select coalesce(avg(actual_hours/estimated_hours),1) from chosen;
$$;
create or replace function public.hr_workload(w uuid, employee text, next_week boolean default false) returns numeric
language sql stable set search_path=public as $$
 select coalesce(sum(personalized_hours),0) from hr_tasks where workspace_id=w and employee_id=employee and status in ('todo','in_progress')
 and deadline < (case when next_week then '2026-10-05T00:00:00+07:00' else '2026-09-28T00:00:00+07:00' end)::timestamptz
 and (not next_week or deadline>='2026-09-28T00:00:00+07:00'::timestamptz);
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
 (w,'presentation-0','presentation','Review analytics with John',true,45,0),(w,'presentation-1','presentation','Collect relevant data',true,30,1),
 (w,'presentation-2','presentation','Draft presentation',false,120,2),(w,'presentation-3','presentation','Add visuals',false,90,3),
 (w,'presentation-4','presentation','Review slides',false,45,4),(w,'presentation-5','presentation','Finalize and send',false,30,5),
 (w,'research-0','research','Choose three competitors',false,30,0),(w,'research-1','research','Compare onboarding flows',false,90,1),(w,'research-2','research','Summarize opportunities',false,60,2);
 insert into hr_history(workspace_id,id,employee_id,category,estimated_hours,actual_hours,completed_at)
 select w,'history-'||v.category||'-'||n,'alex',v.category,v.estimated,v.actual,('2026-09-18T10:00:00Z'::timestamptz-n*interval '1 day')
 from (values ('Presentation',8,9),('Research',6,7),('Testing',4,5),('Analytics',5,6),('Design',1,1)) as v(category,estimated,actual) cross join generate_series(0,2) n;
end;
$$;
create or replace function public.hr_state_json(w uuid) returns jsonb language sql stable set search_path=public as $$
 select jsonb_build_object(
 'workspace',(select jsonb_build_object('id',id,'version',version,'demo_date',demo_date) from hr_workspaces where id=w),
 'profiles',coalesce((select jsonb_agg(to_jsonb(p)-'workspace_id' order by id) from hr_profiles p where workspace_id=w),'[]'::jsonb),
 'tasks',coalesce((select jsonb_agg(to_jsonb(t)-'workspace_id' order by id) from hr_tasks t where workspace_id=w),'[]'::jsonb),
 'subtasks',coalesce((select jsonb_agg(to_jsonb(s)-'workspace_id' order by task_id,position) from hr_subtasks s where workspace_id=w),'[]'::jsonb),
 'history',coalesce((select jsonb_agg(to_jsonb(h)-'workspace_id' order by completed_at desc,id) from hr_history h where workspace_id=w),'[]'::jsonb),
 'negotiations',coalesce((select jsonb_agg(to_jsonb(n)-'workspace_id' order by created_at desc) from hr_negotiations n where workspace_id=w),'[]'::jsonb),
 'messages',coalesce((select jsonb_agg(to_jsonb(m)-'workspace_id' order by created_at,id) from hr_messages m where workspace_id=w),'[]'::jsonb),
 'dependencies',coalesce((select jsonb_agg(to_jsonb(d)-'workspace_id') from hr_dependencies d where workspace_id=w),'[]'::jsonb));
$$;
create or replace function public.headroom_state() returns jsonb language plpgsql security definer set search_path=public as $$
declare w uuid;
begin
 if auth.uid() is null then raise exception 'Please sign in to open your workspace.'; end if;
 -- Serialize first login and mutations for each authenticated owner.
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 select id into w from hr_workspaces where owner_id=auth.uid();
 if w is null then
   insert into hr_workspaces(owner_id) values(auth.uid()) returning id into w;
   perform hr_seed(w);
 end if;
 return hr_state_json(w);
end;
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
   if date_new>='2026-09-28T00:00:00+07:00'::timestamptz and hr_workload(w,'alex',true)+t.personalized_hours>(select capacity from hr_profiles where workspace_id=w and id='alex') then raise exception 'This would exceed next week''s capacity.'; end if;
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
create or replace function public.headroom_action(op text,payload jsonb,expected_version integer) returns jsonb
language plpgsql security definer set search_path=public as $$
declare w uuid; v integer; t hr_tasks%rowtype; n hr_negotiations%rowtype; p jsonb; request_id text; message text; role_name text; actual numeric; ratio numeric;
begin
 if auth.uid() is null then raise exception 'Please sign in to save changes.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 select id,version into w,v from hr_workspaces where owner_id=auth.uid() for update;
 if w is null then raise exception 'Open the workspace before making changes.'; end if;
 if expected_version is null or v<>expected_version then raise exception 'Your workspace has changed. Refresh before trying again.'; end if;
 role_name := payload->>'role';
 if role_name is null or role_name not in ('employee','manager') then raise exception 'Choose a demo role.'; end if;
 if op='activate' then
   if role_name<>'employee' then raise exception 'Switch to Employee to start the demo assignment.'; end if;
   ratio:=hr_multiplier(w,'alex','Research');
   update hr_tasks set status='todo',multiplier=ratio,personalized_hours=estimated_hours*ratio,version=version+1 where workspace_id=w and id='new-research' and status='draft';
   if not found then raise exception 'The demo assignment is already active.'; end if;
 elsif op in ('subtask','hours','complete') then
   if role_name<>'employee' then raise exception 'Switch to Employee to update a task.'; end if;
   if op='subtask' then
     select t1.* into t from hr_tasks t1 join hr_subtasks s on s.workspace_id=t1.workspace_id and s.task_id=t1.id where s.workspace_id=w and s.id=payload->>'id';
   else select * into t from hr_tasks where workspace_id=w and id=payload->>'id'; end if;
   if not found or t.employee_id<>'alex' or t.status not in ('todo','in_progress') then raise exception 'This task cannot be changed.'; end if;
   if op='subtask' then
     update hr_subtasks set completed=not completed where workspace_id=w and id=payload->>'id';
   else
     actual:=(payload->>'actual_hours')::numeric;
     if actual is null or actual<0 or actual>500 or (op='complete' and actual=0) then raise exception 'Enter actual hours between 0 and 500 (greater than zero to complete).'; end if;
     update hr_tasks set actual_hours=actual where workspace_id=w and id=t.id;
     if op='complete' then
       if exists(select 1 from hr_dependencies d join hr_tasks dep on dep.workspace_id=d.workspace_id and dep.id=d.prerequisite_id where d.workspace_id=w and d.task_id=t.id and dep.status<>'completed') then raise exception 'Complete the prerequisite first.'; end if;
       update hr_tasks set status='completed' where workspace_id=w and id=t.id;
       update hr_subtasks set completed=true where workspace_id=w and task_id=t.id;
       insert into hr_history(workspace_id,id,employee_id,task_id,category,estimated_hours,actual_hours) values(w,gen_random_uuid()::text,t.employee_id,t.id,t.category,t.estimated_hours,actual);
     end if;
   end if;
   update hr_tasks set version=version+1 where workspace_id=w and id=t.id;
 elsif op in ('request','counter','revise') then
   if (op='counter' and role_name<>'manager') or (op in ('request','revise') and role_name<>'employee') then raise exception 'Switch to the appropriate demo role.'; end if;
   p:=payload->'proposal'; message:=trim(payload->>'message');
   if message is null or length(message) not between 1 and 4000 then raise exception 'Write a message between 1 and 4000 characters.'; end if;
   perform hr_validate_proposal(w,p);
   if op='request' then
     if exists(select 1 from hr_negotiations where workspace_id=w and status in ('pending','counter_proposed')) then raise exception 'There is already an open workload request.'; end if;
     insert into hr_negotiations(workspace_id,status,proposal,workload_snapshot) values(w,'pending',p,hr_workload(w,'alex')) returning * into n;
   else
     select * into n from hr_negotiations where workspace_id=w and id=payload->>'id' for update;
     if not found or (op='counter' and n.status<>'pending') or (op='revise' and n.status<>'counter_proposed') then raise exception 'This request is no longer awaiting that response.'; end if;
     update hr_negotiations set proposal=p,revision=revision+1,status=case when op='counter' then 'counter_proposed' else 'pending' end,updated_at=now() where workspace_id=w and id=n.id returning * into n;
   end if;
   insert into hr_proposals(workspace_id,negotiation_id,revision,author,proposal) values(w,n.id,n.revision,role_name,p);
   insert into hr_messages(workspace_id,negotiation_id,author,body,revision) values(w,n.id,role_name,message,n.revision);
 elsif op in ('approve','accept','decline','cancel') then
   select * into n from hr_negotiations where workspace_id=w and id=payload->>'id' for update;
   if not found then raise exception 'Request not found.'; end if;
   if op in ('approve','decline') and (role_name<>'manager' or n.status<>'pending') then raise exception 'This request is no longer pending manager review.'; end if;
   if op='accept' and (role_name<>'employee' or n.status<>'counter_proposed') then raise exception 'This counter-proposal is no longer awaiting acceptance.'; end if;
   if op='cancel' and (role_name<>'employee' or n.status not in ('pending','counter_proposed')) then raise exception 'This request cannot be cancelled.'; end if;
   if op in ('approve','accept') then
     p:=n.proposal;
     perform hr_validate_proposal(w,p);
     select * into t from hr_tasks where workspace_id=w and id=p->>'task_id';
     if p->>'type'='deadline' then update hr_tasks set deadline=(p->>'deadline')::timestamptz,version=version+1 where workspace_id=w and id=t.id;
     elsif p->>'type'='scope' then update hr_tasks set personalized_hours=personalized_hours-(p->>'scope_hours')::numeric,estimated_hours=(personalized_hours-(p->>'scope_hours')::numeric)/multiplier,scope_saving=scope_saving-(p->>'scope_hours')::numeric,description=description||E'\nAgreed scope: omit detailed competitor analysis.',version=version+1 where workspace_id=w and id=t.id;
     else
       ratio:=hr_multiplier(w,p->>'employee_id',t.category);
       update hr_tasks set employee_id=p->>'employee_id',personalized_hours=estimated_hours*ratio,multiplier=ratio,version=version+1 where workspace_id=w and id=t.id;
     end if;
   end if;
   update hr_negotiations set status=case when op='decline' then 'declined' when op='cancel' then 'cancelled' else 'approved' end,updated_at=now() where workspace_id=w and id=n.id;
   insert into hr_messages(workspace_id,negotiation_id,author,body,revision) values(w,n.id,role_name,case op when 'approve' then 'Approved. The agreed adjustment is now reflected in our workload.' when 'accept' then 'I accepted this counter-proposal. The adjustment is now applied.' when 'decline' then 'This request was declined. The current assignments remain unchanged.' else 'This request was cancelled.' end,n.revision);
 elsif op='reset' then
   -- Reset only this signed-in user's synthetic demo. No real employee data exists here.
   delete from hr_negotiations where workspace_id=w;
   delete from hr_history where workspace_id=w;
   delete from hr_tasks where workspace_id=w;
   delete from hr_profiles where workspace_id=w;
   perform hr_seed(w);
 else raise exception 'Unknown workspace action.';
 end if;
 update hr_workspaces set version=version+1 where id=w;
 return hr_state_json(w);
end;
$$;

-- Every table is isolated to the owning authenticated user. Writes go through RPCs.
do $$ declare tbl text; begin
 foreach tbl in array array['hr_workspaces','hr_profiles','hr_tasks','hr_subtasks','hr_history','hr_dependencies','hr_negotiations','hr_proposals','hr_messages'] loop
   execute format('alter table public.%I enable row level security',tbl);
   execute format('revoke all on public.%I from anon, authenticated',tbl);
   execute format('grant select on public.%I to authenticated',tbl);
   execute format('drop policy if exists owner_read on public.%I',tbl);
   if tbl='hr_workspaces' then
     execute format('create policy owner_read on public.%I for select to authenticated using (owner_id = (select auth.uid()))',tbl);
   else
     execute format('create policy owner_read on public.%I for select to authenticated using (workspace_id in (select id from public.hr_workspaces where owner_id=(select auth.uid())))',tbl);
   end if;
 end loop;
end $$;
revoke all on function public.hr_seed(uuid) from public,anon,authenticated;
revoke all on function public.hr_multiplier(uuid,text,text) from public,anon,authenticated;
revoke all on function public.hr_workload(uuid,text,boolean) from public,anon,authenticated;
revoke all on function public.hr_state_json(uuid) from public,anon,authenticated;
revoke all on function public.hr_validate_proposal(uuid,jsonb) from public,anon,authenticated;
revoke all on function public.headroom_state() from public,anon;
revoke all on function public.headroom_action(text,jsonb,integer) from public,anon;
grant execute on function public.headroom_state() to authenticated;
grant execute on function public.headroom_action(text,jsonb,integer) to authenticated;
-- The workspace version changes after every mutation, keeping all tabs in sync.
do $$ begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='hr_workspaces') then
   alter publication supabase_realtime add table public.hr_workspaces;
 end if;
end $$;
notify pgrst, 'reload schema';
commit;
