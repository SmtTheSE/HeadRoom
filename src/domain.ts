import type { AppState, History, Profile, Proposal, Task } from "./types";
export const DEMO_DATE = "2026-09-23";
export const WEEK_START = "2026-09-21T00:00:00+07:00";
export const WEEK_END = "2026-09-28T00:00:00+07:00";
export const NEXT_END = "2026-10-05T00:00:00+07:00";
export const active = (t: Task) =>
  t.status === "todo" || t.status === "in_progress";
export const hours = (n: number) =>
  new Intl.NumberFormat("en", { maximumFractionDigits: 1 }).format(n);
export function workload(tasks: Task[], employee = "alex", next = false) {
  return tasks
    .filter(
      (t) =>
        t.employee_id === employee &&
        active(t) &&
        Date.parse(t.deadline) < Date.parse(next ? NEXT_END : WEEK_END) &&
        (!next || Date.parse(t.deadline) >= Date.parse(WEEK_END)),
    )
    .reduce((n, t) => n + Number(t.personalized_hours), 0);
}
export function status(load: number, capacity: number) {
  const ratio = load / capacity;
  return ratio > 1
    ? { label: "Capacity Conflict", tone: "danger" }
    : ratio >= 0.9
      ? { label: "Near Capacity", tone: "warning" }
      : ratio >= 0.7
        ? { label: "Busy", tone: "blue" }
        : { label: "Comfortable", tone: "good" };
}
export function multiplier(
  history: History[],
  employee: string,
  category: string,
) {
  const valid = history
    .filter(
      (h) =>
        h.employee_id === employee &&
        h.estimated_hours > 0 &&
        h.actual_hours > 0,
    )
    .sort((a, b) => b.completed_at.localeCompare(a.completed_at));
  const specific = valid.filter((h) => h.category === category);
  const selected = (specific.length >= 3 ? specific : valid).slice(0, 10);
  return {
    value: selected.length
      ? selected.reduce((v, h) => v + h.actual_hours / h.estimated_hours, 0) /
        selected.length
      : 1,
    count: selected.length,
    categorySpecific: specific.length >= 3,
  };
}
export function due(iso: string, short = false) {
  return new Intl.DateTimeFormat("en", {
    weekday: short ? "short" : "long",
    month: short ? "short" : undefined,
    day: short ? "numeric" : undefined,
    hour: short ? undefined : "numeric",
    minute: short ? undefined : "2-digit",
    timeZone: "Asia/Bangkok",
  }).format(new Date(iso));
}
export function risk(task: Task, state: AppState) {
  if (!active(task)) return null;
  const now = Date.parse(state.workspace.demo_date + "T09:00:00+07:00"),
    deadline = Date.parse(task.deadline);
  if (deadline < now) return "Overdue";
  const soon = deadline < now + 2 * 86400000;
  if (
    soon &&
    state.dependencies.some(
      (d) =>
        d.task_id === task.id &&
        state.tasks.find((t) => t.id === d.prerequisite_id)?.status !==
          "completed",
    )
  )
    return "Waiting on a dependency";
  const p = state.profiles.find((p) => p.id === task.employee_id);
  if (soon && p && workload(state.tasks, p.id) > p.capacity)
    return "Due soon · capacity conflict";
  return null;
}
export function applyPreview(state: AppState, proposal: Proposal) {
  return state.tasks.map((t) => {
    if (t.id !== proposal.task_id) return t;
    if (proposal.type === "deadline")
      return { ...t, deadline: proposal.deadline! };
    if (proposal.type === "scope")
      return {
        ...t,
        personalized_hours: Math.max(
          0,
          t.personalized_hours - proposal.scope_hours!,
        ),
      };
    const m = multiplier(
      state.history,
      proposal.employee_id!,
      t.category,
    ).value;
    return {
      ...t,
      employee_id: proposal.employee_id!,
      personalized_hours: t.estimated_hours * m,
      multiplier: m,
    };
  });
}
export function recommendations(state: AppState): Proposal[] {
  const eligible = state.tasks.filter(
    (t) =>
      t.employee_id === "alex" &&
      active(t) &&
      Date.parse(t.deadline) < Date.parse(WEEK_END),
  );
  const result: Proposal[] = [];
  for (const id of ["analytics", "new-research"]) {
    const task = eligible.find((t) => t.id === id);
    if (task?.flexible)
      result.push({
        type: "deadline",
        task_id: task.id,
        task_version: task.version,
        deadline: "2026-09-28T10:00:00Z",
        label: `Move ${task.title} to next Monday`,
      });
  }
  const presentation = eligible.find((t) => t.id === "presentation");
  if (presentation && presentation.scope_saving > 0)
    result.push({
      type: "scope",
      task_id: presentation.id,
      task_version: presentation.version,
      scope_hours: Math.min(2, presentation.scope_saving),
      label: "Simplify the client presentation",
    });
  const testing = eligible.find((t) => t.id === "testing");
  if (testing) {
    const candidate = state.profiles
      .filter((p) => p.id !== "alex" && p.id !== "sarah")
      .find(
        (p) =>
          workload(state.tasks, p.id) +
            testing.estimated_hours *
              multiplier(state.history, p.id, testing.category).value <=
          p.capacity,
      );
    if (candidate)
      result.push({
        type: "reassign",
        task_id: testing.id,
        task_version: testing.version,
        employee_id: candidate.id,
        label: `Share prototype testing with ${candidate.name.split(" ")[0]}`,
      });
  }
  return result;
}
export const person = (state: AppState, id = "alex"): Profile =>
  state.profiles.find((p) => p.id === id)!;
