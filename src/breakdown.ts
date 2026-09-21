import { supabase } from "./data";
import type { Task } from "./types";

export type Step = { title: string; minutes: number };

/* Offline planner used when the `breakdown` edge function is not deployed.
   Weights are shares of the task's personalized hours. */
const PLANS: Record<string, [string, number][]> = {
  Research: [
    ["Define the questions to answer", 0.1],
    ["Gather sources and examples", 0.3],
    ["Review and take notes", 0.25],
    ["Synthesize findings", 0.2],
    ["Write the summary", 0.15],
  ],
  Presentation: [
    ["Outline the key messages", 0.15],
    ["Draft the slides", 0.35],
    ["Add visuals and examples", 0.25],
    ["Rehearse and refine", 0.15],
    ["Final review and send", 0.1],
  ],
  Testing: [
    ["Define test scenarios", 0.15],
    ["Prepare the test setup", 0.15],
    ["Run the sessions", 0.4],
    ["Log issues and observations", 0.15],
    ["Summarize results", 0.15],
  ],
  Analytics: [
    ["Clarify the metrics needed", 0.1],
    ["Collect the data", 0.25],
    ["Clean and analyze", 0.3],
    ["Build the charts", 0.2],
    ["Write the report", 0.15],
  ],
  Design: [
    ["Review the requirements", 0.15],
    ["Sketch a few options", 0.3],
    ["Refine the chosen direction", 0.3],
    ["Collect feedback", 0.1],
    ["Finalize for handoff", 0.15],
  ],
};
const DEFAULT_PLAN: [string, number][] = [
  ["Clarify the goal and scope", 0.15],
  ["Do the core work", 0.5],
  ["Review and refine", 0.2],
  ["Wrap up and share", 0.15],
];

export function planSteps(task: Task): Step[] {
  const total = Math.max(1, task.personalized_hours) * 60;
  return (PLANS[task.category] ?? DEFAULT_PLAN).map(([title, share]) => ({
    title,
    minutes: Math.max(15, Math.round((total * share) / 5) * 5),
  }));
}

function valid(steps: unknown): steps is Step[] {
  return (
    Array.isArray(steps) &&
    steps.length >= 2 &&
    steps.length <= 8 &&
    steps.every(
      (s) =>
        typeof s?.title === "string" &&
        s.title.trim() &&
        Number.isInteger(s?.minutes) &&
        s.minutes >= 5 &&
        s.minutes <= 480,
    )
  );
}

/** Steps from Claude via the edge function, or the offline planner when it is unavailable. */
export async function generateSteps(
  task: Task,
): Promise<{ steps: Step[]; source: "ai" | "offline" }> {
  try {
    const { data, error } = await supabase.functions.invoke("breakdown", {
      body: {
        title: task.title,
        description: task.description,
        category: task.category,
        hours: task.personalized_hours,
      },
    });
    if (!error && valid(data?.steps))
      return { steps: data.steps, source: "ai" };
  } catch {
    /* fall through to the offline planner */
  }
  return { steps: planSteps(task), source: "offline" };
}
