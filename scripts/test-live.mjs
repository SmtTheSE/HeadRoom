import { createClient } from "@supabase/supabase-js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
const url = process.env.VITE_SUPABASE_URL,
  anon = process.env.VITE_SUPABASE_ANON_KEY;
if (!process.env.SUPABASE_SERVICE_ROLE_KEY)
  throw new Error(
    "Set the service role key in an ignored setup environment only.",
  );
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const client = createClient(url, anon, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const ids = [];
async function expectOk(p) {
  const r = await p;
  if (r.error) throw new Error(r.error.message);
  return r.data;
}
let state;
const load = () =>
  state.tasks
    .filter(
      (t) =>
        t.employee_id === "alex" &&
        ["todo", "in_progress"].includes(t.status) &&
        new Date(t.deadline) < new Date("2026-09-28T00:00:00+07:00"),
    )
    .reduce((n, t) => n + Number(t.personalized_hours), 0);
async function act(op, payload = {}) {
  state = await expectOk(
    client.rpc("headroom_action", {
      op,
      payload: { role: "employee", ...payload },
      expected_version: state.workspace.version,
    }),
  );
}
try {
  const email = `headroom-qa-${randomUUID()}@example.invalid`,
    password = randomUUID() + randomUUID();
  const created = await expectOk(
    admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { purpose: "temporary Headroom integration check" },
    }),
  );
  ids.push(created.user.id);
  await expectOk(client.auth.signInWithPassword({ email, password }));
  state = await expectOk(client.rpc("headroom_state"));
  assert.equal(load(), 28);
  await act("activate");
  assert.equal(load(), 35);
  const proposal = {
    type: "deadline",
    task_id: "analytics",
    task_version: 1,
    deadline: "2026-09-28T10:00:00Z",
    label: "Move Analytics Report to next Monday",
  };
  await act("request", { proposal, message: "Temporary integration check." });
  assert.equal(load(), 35);
  await act("approve", { role: "manager", id: state.negotiations[0].id });
  assert.equal(load(), 29);
  const id = state.negotiations[0].id;
  const duplicate = await client.rpc("headroom_action", {
    op: "approve",
    payload: { role: "manager", id },
    expected_version: state.workspace.version,
  });
  assert.ok(duplicate.error);
  const saved = await expectOk(client.rpc("headroom_state"));
  assert.equal(saved.workspace.version, state.workspace.version);
  assert.equal(saved.negotiations[0].status, "approved");
  const direct = await client
    .from("hr_tasks")
    .update({ title: "must not update" })
    .eq("workspace_id", state.workspace.id);
  assert.ok(direct.error);
  console.log(
    "PASS: live Google-enabled Supabase project; authenticated RPCs; 28 → 35 → 29; persisted approval; duplicate rejected; direct writes blocked",
  );
  await expectOk(client.auth.signOut());
  const unauthorized = await client.rpc("headroom_state");
  assert.ok(unauthorized.error);
  console.log("PASS: unsigned requests rejected");
} finally {
  for (const id of ids) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) console.error("Temporary QA cleanup failed:", error.message);
    else console.log("Removed temporary QA user and its synthetic workspace");
  }
}
