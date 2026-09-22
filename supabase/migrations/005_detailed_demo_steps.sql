-- Keep the preloaded demo checklist concrete after both migration and reset.
create or replace function public.hr_specific_demo_step_title()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.title := case new.id
    when 'presentation-0' then 'Confirm the client decision and write the deck’s one-sentence takeaway'
    when 'presentation-1' then 'Collect the 3 analytics findings that directly support the recommendation'
    when 'presentation-2' then 'Build a 6-slide outline with context, evidence, options, recommendation, and next steps'
    when 'presentation-3' then 'Add one labeled chart or screenshot to every slide that makes a factual claim'
    when 'presentation-4' then 'Run a 5-minute rehearsal and flag slides that take more than 45 seconds'
    when 'presentation-5' then 'Fix flagged slides, verify names and numbers, then export the review PDF'
    when 'research-0' then 'Write the 3 competitor names and create columns for price, audience, promise, and source'
    when 'research-1' then 'Complete each onboarding flow and save 2 screenshots that show key decisions'
    when 'research-2' then 'Write 3 product opportunities, each tied to one screenshot or table finding'
    else new.title
  end;
  return new;
end;
$$;

drop trigger if exists hr_specific_demo_step_title_trigger on public.hr_subtasks;
create trigger hr_specific_demo_step_title_trigger
before insert on public.hr_subtasks
for each row execute function public.hr_specific_demo_step_title();

update public.hr_subtasks
set title = case id
  when 'presentation-0' then 'Confirm the client decision and write the deck’s one-sentence takeaway'
  when 'presentation-1' then 'Collect the 3 analytics findings that directly support the recommendation'
  when 'presentation-2' then 'Build a 6-slide outline with context, evidence, options, recommendation, and next steps'
  when 'presentation-3' then 'Add one labeled chart or screenshot to every slide that makes a factual claim'
  when 'presentation-4' then 'Run a 5-minute rehearsal and flag slides that take more than 45 seconds'
  when 'presentation-5' then 'Fix flagged slides, verify names and numbers, then export the review PDF'
  when 'research-0' then 'Write the 3 competitor names and create columns for price, audience, promise, and source'
  when 'research-1' then 'Complete each onboarding flow and save 2 screenshots that show key decisions'
  when 'research-2' then 'Write 3 product opportunities, each tied to one screenshot or table finding'
  else title
end
where id in (
  'presentation-0', 'presentation-1', 'presentation-2',
  'presentation-3', 'presentation-4', 'presentation-5',
  'research-0', 'research-1', 'research-2'
);

revoke all on function public.hr_specific_demo_step_title() from public, anon, authenticated;
