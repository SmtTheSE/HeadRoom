import { supabase } from "./data";
import type { Task } from "./types";
import {
  validateSteps,
  type BreakdownResult,
} from "../supabase/functions/_shared/checklist";
export async function generateSteps(
  task: Task,
  workspaceVersion: number,
): Promise<BreakdownResult> {
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
