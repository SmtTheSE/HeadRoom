import { describe, expect, it } from "vitest";
import { previewState } from "./seed";
import {
  applyPreview,
  dueRelative,
  multiplier,
  recommendations,
  remaining,
  status,
  workload,
} from "./domain";
const steps = previewState.subtasks;
describe("capacity planning", () => {
  it("starts at 27 hours of remaining work and adds the assignment after activation", () => {
    expect(workload(previewState.tasks)).toBe(28); // full estimates, no step data
    expect(workload(previewState.tasks, "alex", false, steps)).toBe(27);
    expect(
      workload(
        previewState.tasks.map((t) =>
          t.id === "new-research" ? { ...t, status: "todo" } : t,
        ),
        "alex",
        false,
        steps,
      ),
    ).toBe(34);
  });
  it("counts remaining effort from steps or logged hours, whichever is further along", () => {
    const presentation = previewState.tasks.find(
      (t) => t.id === "presentation",
    )!;
    expect(remaining(presentation, steps)).toBe(8); // 40 of 360 minutes done on 9h
    expect(remaining({ ...presentation, actual_hours: 8.5 }, steps)).toBe(0.5);
    expect(remaining({ ...presentation, actual_hours: 12 }, steps)).toBe(0);
    const noSteps = previewState.tasks.find((t) => t.id === "analytics")!;
    expect(remaining(noSteps, steps)).toBe(6);
    expect(remaining({ ...noSteps, actual_hours: 2 }, steps)).toBe(4);
  });
  it("uses exact thresholds", () => {
    expect(status(21, 30).label).toBe("On track");
    expect(status(27, 30).label).toBe("Near capacity");
    expect(status(30, 30).label).toBe("Near capacity");
    expect(status(30.1, 30).label).toBe("Over capacity");
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
  it("uses a median, clamps extremes, and blends small samples toward 1", () => {
    const h = (ratio: number, i: number) => ({
      id: `h${i}`,
      employee_id: "alex",
      task_id: null,
      category: "Research",
      estimated_hours: 1,
      actual_hours: ratio,
      completed_at: `2026-09-${10 + i}T10:00:00Z`,
    });
    // one blow-up does not drag the estimate
    expect(
      multiplier([h(1.1, 0), h(1.2, 1), h(1.0, 2), h(4, 3)], "alex", "Research")
        .value,
    ).toBeCloseTo(1.15);
    // clamped
    expect(
      multiplier([h(9, 0), h(9, 1), h(9, 2)], "alex", "Research").value,
    ).toBe(3);
    expect(
      multiplier([h(0.1, 0), h(0.1, 1), h(0.1, 2)], "alex", "Research").value,
    ).toBe(0.5);
    // a single sample is blended two-thirds toward 1.0
    expect(multiplier([h(2, 0)], "alex", "Research").value).toBeCloseTo(4 / 3);
  });
  it("does not remove weekly work when a deadline moves within the week", () => {
    const changed = applyPreview(previewState, {
      type: "deadline",
      task_id: "analytics",
      task_version: 1,
      deadline: "2026-09-25T10:00:00Z",
      label: "Friday",
    });
    expect(workload(changed, "alex", false, steps)).toBe(27);
  });
  it("moves exactly six hours to next week, with partial scope relief remaining a conflict", () => {
    const state = structuredClone(previewState);
    state.tasks.find((t) => t.id === "new-research")!.status = "todo";
    const options = recommendations(state);
    expect(
      workload(applyPreview(state, options[0]), "alex", false, steps),
    ).toBe(28);
    expect(workload(applyPreview(state, options[0]), "alex", true, steps)).toBe(
      6,
    );
    expect(
      workload(
        applyPreview(
          state,
          options.find((p) => p.type === "scope")!,
        ),
        "alex",
        false,
        steps,
      ),
    ).toBeCloseTo(32.22, 2); // 7h × 8/9 remaining on the presentation
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
    expect(workload(changed, "alex", false, steps)).toBe(22);
    expect(workload(changed, p.employee_id, false, steps)).toBe(22);
  });
});

describe("dueRelative", () => {
  const today = "2026-09-23";
  it("names today, tomorrow, weekdays, and dates", () => {
    expect(dueRelative("2026-09-23T10:00:00+07:00", today)).toBe("Today");
    expect(dueRelative("2026-09-24T10:00:00+07:00", today)).toBe("Tomorrow");
    expect(dueRelative("2026-09-25T10:00:00+07:00", today)).toBe("Fri");
    expect(dueRelative("2026-10-05T10:00:00+07:00", today)).toBe("Mon, Oct 5");
    expect(dueRelative("2026-09-22T10:00:00+07:00", today)).toBe(
      "1 day overdue",
    );
  });
});
