import { supabase } from "./data";
import type { Task } from "./types";
import {
  validateSteps,
  allocateMinutes,
  type BreakdownResult,
} from "../supabase/functions/_shared/checklist";
export function generateDemoSteps(task: Task): BreakdownResult {
  const title = task.title.trim().slice(0, 70);
  const plans: Record<string, string[]> = {
    research: [
      `Open the brief for ${title} and list the 3 questions the research must answer`,
      "Add 3 competitors to a table with columns for audience, price, core promise, and source link",
      "Complete each competitor onboarding flow and save 2 screenshots that show key decisions",
      "Score each flow from 1–5 for setup effort, clarity, and time to first value",
      "Write 3 product opportunities, each linked to one screenshot or comparison-table finding",
      "Check every claim and link, then export a one-page research summary",
    ],
    presentation: [
      `Write the audience, decision, and one-sentence takeaway for ${title} at the top of the deck`,
      "Create a 6-slide outline with one question or claim assigned to each slide",
      "Draft each slide with one headline and no more than 3 supporting bullets",
      "Add one chart, screenshot, or example to every slide that needs evidence",
      "Run a 5-minute read-through and mark any slide that takes more than 45 seconds",
      "Fix marked slides, check names and numbers, then export the review copy",
    ],
    testing: [
      `List the 5 highest-risk user flows for ${title} and state the expected result for each`,
      "Prepare the test account, starting screen, and sample input needed for every flow",
      "Run each flow once and record pass, fail, or blocked with one screenshot",
      "Reproduce every failure and write exact steps plus the expected and actual result",
      "Retest fixed or blocked flows and update their status in the results table",
      "Count passes and failures, then write the 3 issues that need attention first",
    ],
    analytics: [
      `Write the 3 decisions ${title} must support and map one metric to each decision`,
      "Export the current and previous period values for every required metric into one sheet",
      "Check date ranges, duplicates, blanks, and totals; record each correction beside the data",
      "Calculate change percentages and split the results by the 2 most useful segments",
      "Create 3 charts and add a one-sentence takeaway directly below each chart",
      "Verify every number against the source, then write 3 recommended next actions",
    ],
    design: [
      `Turn the brief for ${title} into a checklist of required screens, states, and constraints`,
      "Collect 3 relevant references and label the specific pattern worth borrowing from each",
      "Sketch 3 distinct layouts and annotate the primary action in every layout",
      "Build the strongest layout with default, empty, loading, and error states",
      "Check spacing, contrast, labels, and keyboard order against the requirements checklist",
      "Apply fixes and prepare one review link with 3 focused questions for feedback",
    ],
  };
  let titles = plans[task.category.toLowerCase()] ?? [
    `Open the brief for ${title} and write the required result in one sentence`,
    "List the files, inputs, and people already named in the brief; mark anything missing",
    "Create the smallest complete first version of the requested deliverable",
    "Check every requirement against the first version and mark each one complete or missing",
    "Fix the missing items and remove anything that is outside the requested scope",
    "Name the final file clearly and prepare it for the requested handoff",
  ];
  if (task.personalized_hours < 1 / 3)
    titles = [titles[0], titles[2], titles[titles.length - 1]];
  // Large tasks need enough steps to keep each allocation within the 8-hour limit.
  if (task.personalized_hours > 32)
    titles = [
      ...titles,
      "Ask one reviewer to flag unclear, unsupported, or incomplete parts",
      "Resolve every review note and run the final requirements check again",
    ];
  const steps = allocateMinutes(
    titles.map((stepTitle, index) => ({
      title: stepTitle.slice(0, 120),
      minutes: index === 0 || index === titles.length - 1 ? 15 : 30,
    })),
    task.personalized_hours,
  );
  return {
    steps,
    source: "mock",
    model: "local-demo-planner",
    total_minutes: steps.reduce((sum, step) => sum + step.minutes, 0),
  };
}

export async function generateSteps(
  task: Task,
  workspaceVersion: number,
  useApi = true,
): Promise<BreakdownResult> {
  if (!useApi) return generateDemoSteps(task);
  let data: unknown;
  if (import.meta.env.DEV) {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) throw new Error("Sign in before requesting AI breakdown.");
    const response = await fetch("/api/dev/breakdown", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        task_id: task.id,
        expected_version: workspaceVersion,
      }),
      signal: AbortSignal.timeout(65000),
    });
    const result = await response.json();
    if (!response.ok)
      throw new Error(result.error ?? "AI breakdown failed. Please retry.");
    data = result;
  } else {
    const result = await supabase.functions.invoke("breakdown", {
      body: { task_id: task.id, expected_version: workspaceVersion },
    });
    if (result.error) {
      let message =
        "AI breakdown could not connect. Check that the Gemini breakdown function is deployed.";
      try {
        const body = await result.error.context?.json();
        if (typeof body?.error === "string") message = body.error;
      } catch {
        /* retain connection message */
      }
      throw new Error(message);
    }
    data = result.data;
  }
  const result = data as BreakdownResult,
    steps = validateSteps(result);
  if (result.source !== "gemini")
    throw new Error(
      "The breakdown server did not return a real Gemini response.",
    );
  return { ...result, steps };
}
