import {
  BreakdownError,
  validateTask,
  type BreakdownTask,
  type BreakdownResult,
} from "./checklist.ts";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
export function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...cors,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}
export function createBreakdownHandler(options: {
  supabaseUrl: string;
  supabaseAnonKey: string;
  generate: (task: BreakdownTask) => Promise<BreakdownResult>;
  fetcher?: typeof fetch;
}) {
  const fetcher = options.fetcher ?? fetch,
    attempts = new Map<string, number[]>();
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    if (req.method !== "POST")
      return jsonResponse({ error: "Use POST for task breakdown." }, 405);
    try {
      const auth = req.headers.get("Authorization") ?? "";
      if (!auth.startsWith("Bearer "))
        throw new BreakdownError(
          401,
          "Sign in before requesting AI breakdown.",
        );
      if (!options.supabaseUrl || !options.supabaseAnonKey)
        throw new BreakdownError(
          503,
          "The breakdown server is not configured.",
        );
      const headers = { Authorization: auth, apikey: options.supabaseAnonKey };
      const authResponse = await fetcher(
        `${options.supabaseUrl}/auth/v1/user`,
        { headers, signal: AbortSignal.timeout(10000) },
      );
      if (!authResponse.ok)
        throw new BreakdownError(
          401,
          "Your sign-in has expired. Sign in again.",
        );
      const user = await authResponse.json();
      if (!user?.id || user.is_anonymous)
        throw new BreakdownError(
          401,
          "Sign in with your account before requesting AI breakdown.",
        );
      if (!req.headers.get("Content-Type")?.includes("application/json"))
        throw new BreakdownError(415, "Send a JSON request.");
      const raw = await req.text();
      if (raw.length > 4096)
        throw new BreakdownError(413, "This request is too large.");
      let body: { task_id?: unknown; expected_version?: unknown };
      try {
        body = JSON.parse(raw);
      } catch {
        throw new BreakdownError(400, "The request contains invalid JSON.");
      }
      if (
        !body ||
        typeof body.task_id !== "string" ||
        body.task_id.length > 100 ||
        !Number.isInteger(body.expected_version)
      )
        throw new BreakdownError(
          400,
          "Choose a saved task and refresh your workspace.",
        );
      async function rows(path: string) {
        const r = await fetcher(`${options.supabaseUrl}/rest/v1/${path}`, {
          headers,
          signal: AbortSignal.timeout(10000),
        });
        if (!r.ok)
          throw new BreakdownError(
            503,
            "The task could not be loaded. Please retry.",
          );
        return r.json();
      }
      const workspaces = await rows(
          `hr_workspaces?owner_id=eq.${encodeURIComponent(user.id)}&select=id,version&limit=1`,
        ),
        w = workspaces[0];
      if (!w)
        throw new BreakdownError(
          404,
          "Open your workspace before breaking down a task.",
        );
      if (w.version !== body.expected_version)
        throw new BreakdownError(
          409,
          "Your workspace has changed. Refresh before trying again.",
        );
      const tasks = await rows(
          `hr_tasks?workspace_id=eq.${encodeURIComponent(w.id)}&id=eq.${encodeURIComponent(body.task_id)}&select=id,title,description,category,personalized_hours,status,employee_id&limit=1`,
        ),
        task = tasks[0];
      if (
        !task ||
        task.employee_id !== "alex" ||
        !["todo", "in_progress"].includes(task.status)
      )
        throw new BreakdownError(
          404,
          "This task is not available for breakdown.",
        );
      const existing = await rows(
        `hr_subtasks?workspace_id=eq.${encodeURIComponent(w.id)}&task_id=eq.${encodeURIComponent(body.task_id)}&select=id&limit=1`,
      );
      if (existing.length)
        throw new BreakdownError(409, "This task already has steps.");
      // Best-effort per-instance throttling; production-scale quotas need shared storage.
      const now = Date.now();
      for (const [id, times] of attempts)
        if (times.every((t) => now - t >= 60000)) attempts.delete(id);
      const recent = (attempts.get(user.id) ?? []).filter(
        (t) => now - t < 60000,
      );
      if (recent.length >= 3)
        throw new BreakdownError(
          429,
          "Please wait a minute before generating another breakdown.",
        );
      attempts.set(user.id, [...recent, now]);
      return jsonResponse(await options.generate(validateTask(task)));
    } catch (error) {
      return error instanceof BreakdownError
        ? jsonResponse({ error: error.message }, error.status)
        : jsonResponse(
            {
              error:
                "AI breakdown is temporarily unavailable. No steps were saved. Please retry.",
            },
            503,
          );
    }
  };
}
