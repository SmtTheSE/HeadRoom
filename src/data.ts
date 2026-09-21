import { createClient } from "@supabase/supabase-js";
import type { AppState } from "./types";
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
  {
    auth: {
      flowType: "pkce",
      detectSessionInUrl: true,
      persistSession: true,
      autoRefreshToken: true,
    },
  },
);
export async function loadState(): Promise<AppState> {
  const { data, error } = await supabase.rpc("headroom_state");
  if (error) throw new Error(error.message);
  return data as AppState;
}
export async function action(
  op: string,
  payload: Record<string, unknown>,
  version: number,
): Promise<AppState> {
  const { data, error } = await supabase.rpc("headroom_action", {
    op,
    payload,
    expected_version: version,
  });
  if (error) throw new Error(error.message);
  return data as AppState;
}
export async function breakdown(
  taskId: string,
  steps: { title: string; minutes: number }[],
  version: number,
): Promise<AppState> {
  const { data, error } = await supabase.rpc("headroom_breakdown", {
    task_id: taskId,
    steps,
    expected_version: version,
  });
  if (error) throw new Error(error.message);
  return data as AppState;
}
