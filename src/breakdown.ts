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
    research: ["Define the comparison criteria", "Collect relevant examples and evidence", "Compare findings and identify opportunities", "Summarize findings and review the recommendations"],
    presentation: ["Outline the audience needs and main message", "Draft the slide content", "Refine visuals and supporting examples", "Review the deck and rehearse the delivery"],
    testing: ["List the scenarios and expected outcomes", "Run the checks and record results", "Investigate failures and document issues", "Retest fixes and summarize results"],
    analytics: ["Define the questions and required metrics", "Collect and check the available data", "Analyze patterns and prepare findings", "Review calculations and summarize conclusions"],
    design: ["Review the brief and design requirements", "Sketch possible approaches", "Develop the selected design", "Check the design against the brief"],
  };
  let titles = plans[task.category.toLowerCase()] ?? ["Review the requirements", "Prepare a first draft", "Refine the deliverable", "Check the result against the brief"];
  if (task.personalized_hours < 1 / 3) titles = [titles[0], titles[1], titles[3]];
  // Large tasks need enough steps to keep each allocation within the 8-hour limit.
  if (task.personalized_hours > 32) titles = titles.flatMap(t => [t, `Complete and check: ${t.toLowerCase()}`]);
  const steps = allocateMinutes(titles.map((t, i) => ({ title: i === 0 ? `${t}: ${title}`.slice(0, 120) : t, minutes: i === 0 || i === titles.length - 1 ? 15 : 30 })), task.personalized_hours);
  return { steps, source: "mock", model: "local-demo-planner", total_minutes: steps.reduce((sum, s) => sum + s.minutes, 0) };
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
