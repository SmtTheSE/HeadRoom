-- Scope reductions are available on every task: any amount above zero and at
-- most half of the task's personalized hours. The other side must still agree.
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
   if amount is null or amount<=0 or amount>t.personalized_hours/2 then raise exception 'Reduce scope by more than 0 and at most half of the task.'; end if;
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
     elsif p->>'type'='scope' then update hr_tasks set personalized_hours=personalized_hours-(p->>'scope_hours')::numeric,estimated_hours=(personalized_hours-(p->>'scope_hours')::numeric)/multiplier,scope_saving=greatest(0,scope_saving-(p->>'scope_hours')::numeric),description=description||E'\nAgreed scope reduction: '||(p->>'scope_hours')||'h removed.',version=version+1 where workspace_id=w and id=t.id;
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
revoke all on function public.hr_validate_proposal(uuid,jsonb) from public,anon,authenticated;
revoke all on function public.headroom_action(text,jsonb,integer) from public,anon;
grant execute on function public.headroom_action(text,jsonb,integer) to authenticated;
