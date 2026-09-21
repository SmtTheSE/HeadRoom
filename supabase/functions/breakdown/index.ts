import { createBreakdownHandler } from "../_shared/handler.ts";
import { generateWithGemini } from "../_shared/gemini.ts";
// Production has no simulated or offline response path.
Deno.serve(
  createBreakdownHandler({
    supabaseUrl: Deno.env.get("SUPABASE_URL") ?? "",
    supabaseAnonKey: Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    generate: (task) =>
      generateWithGemini(task, {
        apiKey: Deno.env.get("GEMINI_API_KEY"),
        model: Deno.env.get("GEMINI_MODEL"),
      }),
  }),
);
