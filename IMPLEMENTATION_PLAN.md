# ADHD Workplace Capacity Prototype — Implementation Plan

## 1. Outcome and scope

Build a presentation-ready web app showing one connected workflow: Alex reviews organized tasks, sees personalized workload estimates, receives a new assignment that exceeds capacity, proposes an adjustment, and sees workload change after Sarah approves.

Use the requested React, TypeScript, Vite, Tailwind CSS, Lucide, and Supabase stack. Use a prototype role switcher and synthetic data. No custom application server, AI APIs, transcription, external integrations, production authentication, mobile app, or push notifications.

Prioritize a working database-backed demonstration before secondary pages and visual polish. This document is the implementation plan; application development has not started.

## 2. Resolve the brief's inconsistencies

**A deadline change within the same week does not reduce weekly workload.** Change the main negotiation from “Move Analytics Report from Wednesday to Friday” to “Move Analytics Report from Wednesday to next Monday.” A same-week move can remain an option, but must show zero weekly hours saved.

Use one canonical seed dataset throughout all screens:

| Alex's task | Personalized hours | Initial state |
|---|---:|---|
| Client Presentation | 9 | Active this week |
| Competitor Research | 7 | Active this week |
| Prototype Testing | 5 | Active this week |
| Analytics Report | 6 | Active this week, due Wednesday |
| Design Review | 1 | Active this week |
| **Starting total** | **28** | **30h capacity; Near Capacity** |
| New Client Competitor Research | 7 | Draft until demo activation |

Demo arithmetic: **28 → 35 → 29 hours**. Activating the new task adds 7h; approving the Analytics Report move removes 6h from this week's due-date bucket. Next week's workload increases by 6h and must appear in the proposal preview.

Seed Sarah as manager and four employees: Alex, Maya (18/28h), Jordan (26/30h), and Sam (29/32h). Derive overview counts from actual tasks: initially two Near Capacity, one Busy, and one Comfortable; after activation, one Capacity Conflict, one Near Capacity, one Busy, and one Comfortable.

## 3. Product rules to implement first

### Personalized estimates

- For each completed historical task with positive estimated and actual hours, calculate `actual_hours / estimated_hours`.
- Global multiplier: mean of the employee's most recent 10 valid completed-task ratios.
- Category multiplier: mean of the most recent 10 valid ratios in that category, used when at least three samples exist. Otherwise use the global multiplier; fall back to 1.0 when no history exists.
- Personalized estimate: generic estimate multiplied by the selected multiplier. Retain decimal precision for calculations; round to one decimal for display.
- Store the applied multiplier and personalized estimate on the task when it is created or activated. Completing work updates history and multipliers for future estimates; existing commitments do not silently change.
- Seed history and generic estimates that actually produce the canonical totals. For example, three research records with a 7/6 actual-to-estimated ratio give a new 6h research task a 7h personalized estimate. Do not hardcode displayed totals independently of the data.
- Recommended focus capacity is a configured demo value, such as Alex's 30h out of a 40h week. The prototype learns task estimates; it does not infer a medically validated capacity recommendation.

### Workload and status

- Follow the brief's simple model: sum full personalized estimates for active tasks due in the selected week. Draft, completed, and cancelled tasks contribute zero.
- Label this “Active work due this week.” Actual time and subtask progress do not automatically subtract hours; mark this limitation in the calculation explanation. A remaining-effort model is future scope.
- Include overdue active work as carryover once, so it does not disappear from the current week's workload. Show it separately in the breakdown.
- Use Monday-to-next-Monday boundaries, inclusive start and exclusive end, in one configured workspace timezone. Default to Asia/Bangkok for this demo. Store timestamps in UTC.
- Comfortable: below 70%; Busy: 70% to below 90%; Near Capacity: 90% through 100%; Capacity Conflict: above 100%.
- Show available hours as `max(capacity - workload, 0)` and overage as `max(workload - capacity, 0)`.
- Mark a task at risk when overdue, blocked by an unfinished dependency with a deadline in the next two days, or due in the next two days while the employee is over capacity. Show the reason. Treat this as a simple heuristic, not a prediction.

### Negotiation behavior

- Generate suggestions using flexible deadlines, priority, scope-reduction eligibility, and possible reassignees. Seed eligibility so the main demo has predictable options.
- Preview before/after workload for every affected employee and week. For reassignment, use the receiving employee's multiplier and capacity. Suppress options that create a new capacity conflict elsewhere.
- Show whether an option fully resolves the conflict or only reduces it. A 2h scope reduction from 35h leaves 33h and must not show “Conflict Resolved.”
- Sending or counter-proposing does not change task commitments. Apply changes only on manager approval or employee acceptance of a counter-proposal.
- Use statuses `pending`, `counter_proposed`, `approved`, `declined`, and `cancelled`. “Conflict Resolved” is derived from the latest workload after an applied change, not a second terminal request status.
- Keep each proposed revision and message. “Suggest Another Change” creates a new revision and returns the request to pending manager review.
- Revalidate task versions and proposal impact before applying. A stale proposal requires a refreshed preview; repeated approval must not apply the change twice.

## 4. Architecture and data

Frontend structure: route pages, shared visual components, domain calculation functions, and a Supabase repository layer. Use React Router for routes and TanStack Query for shared server-data caching. Keep workload calculations out of page components.

Supabase Postgres is the source of truth. Use database functions for task completion and negotiation application so related writes succeed or fail together. Use Realtime changes to invalidate queries, then refetch canonical data. Also refetch on role switch, window focus, and reconnect. Supabase documents [database functions](https://supabase.com/docs/guides/database/functions) and [Postgres Changes subscriptions](https://supabase.com/docs/guides/realtime/postgres-changes).

| Table | Purpose and important fields |
|---|---|
| `profiles` | ID, name, role, job title, manager ID; Sarah plus four employees |
| `capacity_profiles` | Employee ID, weekly work hours, focus capacity, global multiplier |
| `category_multipliers` | Employee/category, multiplier, sample count, updated timestamp |
| `tasks` | Assignee, assigning manager, title, description, category, priority, status, deadline, generic/personalized/actual hours, applied multiplier, deadline flexibility, scope-reduction allowance, version |
| `subtasks` | Task ID, title, order, completion, estimated minutes |
| `task_dependencies` | Task ID and prerequisite task ID |
| `task_history` | Unique completed task reference, employee, category, original estimate, actual hours, completion time; seeded records may have no live task reference |
| `workload_snapshots` | Employee/week, workload, capacity, capture time for seeded history; never used as the live workload total |
| `negotiations` | Employee, manager, trigger task, status, current proposal revision, submission workload/capacity snapshot, timestamps |
| `negotiation_proposals` | Request, revision, author, change type, affected task/version, original/proposed fields, preview impact |
| `negotiation_messages` | Request/proposal, sender, message text, timestamp |
| `demo_settings` | Fixed scenario date, timezone, scenario version |

Add foreign keys, numeric validation, unique history-per-task protection, status constraints, and indexes for assignee/deadline and manager/request status. Reject dependency cycles. Use a discriminated, validated proposal payload for deadline moves, scope changes, and reassignments.

Keep only synthetic, confirmed work data. The mock role switcher changes presentation; it is not an authorization boundary. Do not create private notes or symptom-data fields. Use a dedicated demo Supabase project, a browser-safe publishable key, and explicitly scoped demo policies/functions; never put a secret or service-role key in Vite environment variables. Real employee/manager access controls require authenticated identities in a later release. See [Supabase data security guidance](https://supabase.com/docs/guides/database/secure-data).

## 5. Build sequence and exit criteria

### Phase 1 — Foundation and deterministic data

1. Scaffold the frontend, navigation, route layout, theme, and role switcher.
2. Create versioned database migrations and an idempotent synthetic seed/reset script.
3. Configure a fixed demo date so Wednesday, Friday, and next Monday stay reproducible. Display “Demo week of …” in the prototype toolbar.
4. Seed profiles, capacities, task history, tasks, subtasks, dependencies, and the inactive new assignment.
5. Implement shared estimate, workload, status, and proposal-impact calculations.

**Exit:** Data-derived totals are Alex 28/30h, Maya 18/28h, Jordan 26/30h, Sam 29/32h; activating the new assignment produces 35/30h exactly once.

### Phase 2 — Minimum connected demo

1. Employee dashboard: greeting, three focus items, capacity bar, deadlines, and Resolve Workload action.
2. Prototype-only “Add demo assignment” control activates the draft task.
3. Resolution screen previews moving Analytics Report to next Monday, including current/next-week impact.
4. Editable message and Send to Manager create a persistent request.
5. Manager dashboard sorts Capacity Conflict first and links to the request.
6. Approval applies the deadline and request status in one transaction.
7. Both views refetch and display 29/30h plus the outcome message.

**Exit:** The full 28 → 35 → request → approval → 29 storyline survives reload and works across two browser tabs.

### Phase 3 — Employee task and capacity experience

1. Add Tasks filters: All, Today, This Week, At Risk, Completed.
2. Add task detail with estimates, deadlines, status, subtasks, dependencies, and actual hours.
3. Make task completion require valid actual hours and create one history record atomically. Subtask completion alone does not complete the parent task.
4. Add My Capacity: task contribution breakdown, current/next-week view, category adjustments, sample counts, and learning explanation.
5. Add employee request list/detail and request timeline.

**Exit:** Task changes persist, learning updates future estimates, and every workload number can be traced to its contributing tasks.

### Phase 4 — Manager decisions and alternate resolutions

1. Add employee detail showing only confirmed assignments, capacity, risks, and requests.
2. Add manager request queue, filters, detail, and decline behavior.
3. Add counter-proposal editing; employee can accept or suggest another revision.
4. Add alternative deadline moves, seeded scope reduction, and reassignment to an employee with capacity.
5. Handle duplicate submission, double approval, stale task versions, and concurrent decisions.

**Exit:** Decline leaves commitments unchanged; accepting a counter-proposal applies only its latest revision; reassignment updates both employees correctly.

### Phase 5 — Presentation polish and validation

1. Use calm cards, readable text, keyboard navigation, visible focus, explicit status labels, and restrained animation.
2. Limit Today's Focus to three items; allow access to all tasks separately. Make capacity bars and task lists reusable across roles.
3. Add loading, empty, error, saving, and reconnect states. Preserve edited request text after a failed send.
4. Supply a repeatable reset command and presentation script. Reset changes only the dedicated synthetic scenario.
5. Validate desktop and narrow-screen layouts, then rehearse the demo from a clean reset.
6. Add setup instructions and `.env.example` with placeholders. Build validation is part of delivery; hosting choice and publication are separate from this plan.

**Exit:** The rehearsed demo passes without manual database edits, misleading totals, stale role views, or console errors.

## 6. Routes and components

Implement the routes from the brief: employee dashboard, tasks, task detail, capacity, negotiation list/detail; manager dashboard, employee detail, negotiation list/detail. Put the role switcher in the shared header; a separate `/view-as` page is unnecessary.

Shared components: `AppShell`, `RoleSwitcher`, `CapacityCard`, `CapacityBar`, `WorkloadStatus`, `TaskCard`, `TaskBreakdown`, `ProposalPreview`, `NegotiationTimeline`, and `DemoToolbar`.

Suggested source folders: `app/`, `pages/employee/`, `pages/manager/`, `components/`, `domain/`, `data/`, and `test/`. Keep migrations and seed data under `supabase/`.

## 7. Focused validation

- Unit tests: multiplier fallback, category sample threshold, rounding, exact workload thresholds, week boundaries, overdue carryover, and draft exclusion.
- Proposal tests: same-week move saves 0h, moving Analytics to next Monday saves 6h, reducing scope by 2h leaves a conflict, and reassignment uses the recipient's estimates.
- Database integration tests: atomic approval, duplicate approval, stale revision rejection, counter-proposal acceptance, and one history record per completed task.
- Browser tests: main storyline in two tabs, reload persistence, decline, and counter-proposal acceptance.
- Manual checks: role switching, keyboard access, task completion, error recovery, reset, and narrow viewport layout.

## 8. Final demo script

1. Reset the scenario and open Alex's dashboard at **28/30h**.
2. Show organized subtasks and the historical ratios behind personalized estimates.
3. Activate the new **7h** assignment; show **35/30h**, **5h over capacity**.
4. Select **Move Analytics Report to next Monday**; preview **29/30h** and next week's added **6h**.
5. Send the editable request; show that workload remains **35/30h** while approval is pending.
6. Switch to Sarah; Alex is first in the conflict list, with one pending request.
7. Review the task breakdown and approve.
8. Return to Alex; show **29/30h**, **Near Capacity**, and **Conflict Resolved**.

## 9. Deliverables and prioritization

Deliver the application source, migrations, seed/reset script, environment-variable template, setup README, focused tests, and demo script.

Phases 1–2 are the first working milestone. Phases 3–4 complete the requested prototype behavior. Phase 5 makes it presentation-ready. If the hackathon deadline becomes tight, defer historical charts and additional suggestion variants before compromising the connected approval flow, correct calculations, or reset reliability.

Before implementation needs a live shared database, provide a dedicated Supabase project URL and publishable key. Schema, UI, and calculation work can begin locally. Presentation deadline and hosting destination remain unspecified; no delivery date or deployment is assumed.
