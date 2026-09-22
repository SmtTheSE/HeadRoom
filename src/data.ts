import { createClient } from "@supabase/supabase-js";
import type { AppState } from "./types";

// These are public browser credentials. Environment variables can override them,
// while the defaults keep preview deployments usable without dashboard access.
const supabaseUrl =
  import.meta.env.VITE_SUPABASE_URL?.trim() ||
  "https://ptdgrejkeaamfqkbxepf.supabase.co";
const supabaseAnonKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB0ZGdyZWprZWFhbWZxa2J4ZXBmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk5NzU3ODMsImV4cCI6MjEwNTU1MTc4M30.gH1YyZ_u7_NttdvajXABDFdW6uZLmOEQBV5n_Iyz60k";

export const supabase = createClient(
  supabaseUrl,
  supabaseAnonKey,
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
