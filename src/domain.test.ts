import { describe, expect, it } from "vitest";
import { previewState } from "./seed";
import {
  applyPreview,
  multiplier,
  recommendations,
  status,
  workload,
} from "./domain";
describe("capacity planning", () => {
  it("starts at 28 hours and only includes the assignment after activation", () => {
    expect(workload(previewState.tasks)).toBe(28);
    expect(
      workload(
        previewState.tasks.map((t) =>
          t.id === "new-research" ? { ...t, status: "todo" } : t,
        ),
      ),
    ).toBe(35);
  });
  it("uses exact thresholds", () => {
    expect(status(21, 30).label).toBe("Busy");
    expect(status(27, 30).label).toBe("Near Capacity");
    expect(status(30, 30).label).toBe("Near Capacity");
    expect(status(30.1, 30).label).toBe("Capacity Conflict");
  });
  it("learns the research multiplier and uses an honest fallback", () => {
    expect(
      multiplier(previewState.history, "alex", "Research").value,
    ).toBeCloseTo(7 / 6);
    expect(multiplier([], "alex", "Research").value).toBe(1);
    expect(
      multiplier(previewState.history.slice(0, 2), "alex", "Research")
        .categorySpecific,
    ).toBe(false);
  });
  it("does not remove weekly work when a deadline moves within the week", () => {
    const changed = applyPreview(previewState, {
      type: "deadline",
      task_id: "analytics",
      task_version: 1,
      deadline: "2026-09-25T10:00:00Z",
      label: "Friday",
    });
    expect(workload(changed)).toBe(28);
  });
  it("moves exactly six hours to next week, with partial scope relief remaining a conflict", () => {
    const state = structuredClone(previewState);
    state.tasks.find((t) => t.id === "new-research")!.status = "todo";
    const options = recommendations(state);
    expect(workload(applyPreview(state, options[0]))).toBe(29);
    expect(workload(applyPreview(state, options[0]), "alex", true)).toBe(6);
    expect(
      workload(
        applyPreview(
          state,
          options.find((p) => p.type === "scope")!,
        ),
      ),
    ).toBe(33);
  });
  it("includes overdue carryover once and excludes next week", () => {
    const t = structuredClone(previewState.tasks[0]);
    t.deadline = "2026-09-01T10:00:00Z";
    expect(workload([t])).toBe(9);
    t.deadline = "2026-09-27T17:00:00Z";
    expect(workload([t])).toBe(0);
    expect(workload([t], "alex", true)).toBe(9);
  });
  it("reassigns using the recipients own multiplier", () => {
    const p = recommendations(previewState).find((p) => p.type === "reassign")!;
    const changed = applyPreview(previewState, p);
    expect(workload(changed, "alex")).toBe(23);
    expect(workload(changed, p.employee_id)).toBe(22);
  });
});
