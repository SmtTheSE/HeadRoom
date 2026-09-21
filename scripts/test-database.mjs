import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs/promises";
import assert from "node:assert/strict";
const db = new PGlite();
await db.exec(
  `create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;`,
);
for (const file of (await fs.readdir("supabase/migrations"))
  .filter((x) => x.endsWith(".sql"))
  .sort())
  await db.exec(await fs.readFile(`supabase/migrations/${file}`, "utf8"));
const user = "11111111-1111-4111-8111-111111111111",
  other = "22222222-2222-4222-8222-222222222222";
await db.query("insert into auth.users(id) values($1),($2)", [user, other]);
await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
await db.exec("set role authenticated");
async function get() {
  return (await db.query("select public.headroom_state() as state")).rows[0]
    .state;
}
let s = await get();
async function act(op, payload, version = s.workspace.version) {
  const r = await db.query("select public.headroom_action($1,$2,$3) as state", [
    op,
    { role: "employee", ...payload },
    version,
  ]);
  s = r.rows[0].state;
  return s;
}
const load = (state = s, id = "alex") =>
  state.tasks
    .filter(
      (t) =>
        t.employee_id === id &&
        ["todo", "in_progress"].includes(t.status) &&
        new Date(t.deadline) < new Date("2026-09-28T00:00:00+07:00"),
    )
    .reduce((sum, t) => sum + Number(t.personalized_hours), 0);
assert.equal(load(), 28);
await act("activate", {});
assert.equal(load(), 35);
const proposal = {
  type: "deadline",
  task_id: "analytics",
  task_version: 1,
  deadline: "2026-09-28T10:00:00Z",
  label: "Move Analytics Report to next Monday",
};
await act("request", { proposal, message: "Please move this deadline." });
assert.equal(load(), 35);
let id = s.negotiations[0].id;
await act("approve", { role: "manager", id });
assert.equal(load(), 29);
assert.equal(s.negotiations[0].status, "approved");
await assert.rejects(
  act("approve", { role: "manager", id }),
  /no longer pending/,
);
await assert.rejects(act("reset", {}, 1), /workspace has changed/);
console.log(
  "PASS: 28 → 35 → pending → approved → 29; duplicate and stale actions rejected",
);
await act("reset", {});
await act("activate", {});
await act("request", { proposal, message: "Request" });
id = s.negotiations[0].id;
await act("counter", {
  role: "manager",
  id,
  proposal: {
    ...proposal,
    task_id: "new-research",
    task_version: 2,
    label: "Move new research to Monday",
  },
  message: "Try this instead.",
});
assert.equal(load(), 35);
await act("accept", { id });
assert.equal(load(), 28);
console.log(
  "PASS: counter-proposal remains unapplied until employee acceptance",
);
await act("reset", {});
await act("activate", {});
await act("request", { proposal, message: "Request" });
id = s.negotiations[0].id;
await act("decline", { role: "manager", id });
assert.equal(load(), 35);
await act("request", { proposal, message: "Try again" });
id = s.negotiations[0].id;
await act("hours", { id: "analytics", actual_hours: 2 });
await assert.rejects(
  act("approve", { role: "manager", id }),
  /task has changed/,
);
assert.equal(load(), 35);
console.log(
  "PASS: decline leaves tasks unchanged; stale task revision rolls back approval",
);
await act("reset", {});
await act("complete", { id: "research", actual_hours: 8 });
assert.equal(s.history.filter((h) => h.task_id === "research").length, 1);
assert.equal(load(), 21);
await assert.rejects(
  act("complete", { id: "research", actual_hours: 8 }),
  /cannot be changed/,
);
await act("activate", {});
assert.equal(
  s.tasks.find((t) => t.id === "new-research").personalized_hours,
  7.25,
);
console.log(
  "PASS: completion creates one history record; new assignments use updated learning",
);
await act("reset", {});
await act("activate", {});
await act("request", {
  proposal: {
    type: "reassign",
    task_id: "testing",
    task_version: 1,
    employee_id: "maya",
    label: "Share testing with Maya",
  },
  message: "Share work",
});
await act("approve", { role: "manager", id: s.negotiations[0].id });
assert.equal(load(), 30);
assert.equal(load(s, "maya"), 22);
console.log(
  "PASS: reassignment uses recipient multiplier and updates both employees",
);
await assert.rejects(
  db.exec("update public.hr_tasks set title='unauthorized'"),
  /permission denied/,
);
await assert.rejects(
  db.query("select public.hr_seed($1)", [s.workspace.id]),
  /permission denied/,
);
// AI breakdown persists validated steps for a task that has none.
async function breakdown(taskId, steps, version = s.workspace.version) {
  const r = await db.query(
    "select public.headroom_breakdown($1,$2,$3) as state",
    [taskId, JSON.stringify(steps), version],
  );
  s = r.rows[0].state;
  return s;
}
const stepsFor = (id) => s.subtasks.filter((x) => x.task_id === id);
assert.equal(stepsFor("analytics").length, 0);
await assert.rejects(
  breakdown("analytics", [{ title: "Only one", minutes: 30 }]),
  /between 2 and 8/,
);
await assert.rejects(
  breakdown("analytics", [
    { title: "Fine", minutes: 30 },
    { title: "", minutes: 30 },
  ]),
  /title and between 5 and 480/,
);
await breakdown("analytics", [
  { title: "Collect the data", minutes: 90 },
  { title: "Clean and analyze", minutes: 120 },
  { title: "Write the report", minutes: 60 },
]);
assert.equal(stepsFor("analytics").length, 3);
assert.deepEqual(
  stepsFor("analytics").map((x) => x.position),
  [1, 2, 3],
);
await assert.rejects(
  breakdown("analytics", [
    { title: "Again", minutes: 30 },
    { title: "Again", minutes: 30 },
  ]),
  /already has steps/,
);
await assert.rejects(
  breakdown("presentation", [
    { title: "Has steps", minutes: 30 },
    { title: "Has steps", minutes: 30 },
  ]),
  /already has steps/,
);
await act("subtask", { id: stepsFor("analytics")[0].id });
assert.equal(stepsFor("analytics")[0].completed, true);
console.log(
  "PASS: AI breakdown validates, stores ordered steps once, and steps are tickable",
);
const firstWorkspace = s.workspace.id;
await db.exec("reset role");
await db.query("select set_config('request.jwt.claim.sub',$1,false)", [other]);
await db.exec("set role authenticated");
s = await get();
assert.notEqual(s.workspace.id, firstWorkspace);
assert.equal(load(), 28);
assert.equal(
  (
    await db.query("select * from public.hr_tasks where workspace_id=$1", [
      firstWorkspace,
    ])
  ).rows.length,
  0,
);
await db.exec("reset role");
await db.query("select set_config('request.jwt.claim.sub','',false)");
await db.exec("set role anon");
await assert.rejects(get(), /permission denied/);
await assert.rejects(
  db.query("select public.headroom_breakdown('analytics','[]'::jsonb,1)"),
  /permission denied/,
);
console.log(
  "PASS: direct writes blocked; helper RPCs blocked; RLS isolates users; anonymous requests blocked",
);
await db.close();
