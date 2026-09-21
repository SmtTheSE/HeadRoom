import type { Plugin } from "vite";
import { loadEnv } from "vite";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { generateWithGemini } from "../supabase/functions/_shared/gemini";
import {
  allocateMinutes,
  BreakdownError,
  DEFAULT_MODEL,
  validateTask,
  type BreakdownResult,
  type BreakdownTask,
} from "../supabase/functions/_shared/checklist";
import {
  createBreakdownHandler,
  jsonResponse,
} from "../supabase/functions/_shared/handler";

// Imported only by Vite's server configuration. Never part of the client bundle.
export function aiDevPlugin(): Plugin {
  return {
    name: "headroom-local-ai",
    apply: "serve",
    configureServer(server) {
      const root = server.config.root;
      const appEnv = loadEnv(server.config.mode, root, "");
      function settings() {
        const file = resolve(root, ".env.server.local");
        const local = existsSync(file)
          ? parseEnv(readFileSync(file, "utf8"))
          : {};
        return {
          apiKey: local.GEMINI_API_KEY || process.env.GEMINI_API_KEY,
          model:
            local.GEMINI_MODEL || process.env.GEMINI_MODEL || DEFAULT_MODEL,
        };
      }
      const generate = (task: BreakdownTask) =>
        generateWithGemini(task, settings());
      const authenticated = createBreakdownHandler({
        supabaseUrl: appEnv.VITE_SUPABASE_URL,
        supabaseAnonKey: appEnv.VITE_SUPABASE_ANON_KEY,
        generate,
      });
      let playgroundActive = false;
      server.middlewares.use(async (req, res, next) => {
        const path = req.url?.split("?")[0];
        if (
          ![
            "/ai-playground",
            "/api/dev/ai-status",
            "/api/dev/ai-playground",
            "/api/dev/breakdown",
          ].includes(path ?? "")
        )
          return next();
        try {
          const host = req.headers.host ?? "";
          if (
            !/^(127\.0\.0\.1|localhost):\d+$/.test(host) ||
            (req.headers.origin && req.headers.origin !== `http://${host}`) ||
            req.headers["sec-fetch-site"] === "cross-site"
          )
            throw new BreakdownError(
              403,
              "Local AI testing is available only from this computer's app origin.",
            );
          if (path === "/ai-playground" && req.method === "GET") {
            res.writeHead(200, {
              "Content-Type": "text/html; charset=utf-8",
              "Cache-Control": "no-store",
              "X-Frame-Options": "DENY",
            });
            res.end(readFileSync(resolve(root, "scripts/ai-playground.html")));
            return;
          }
          if (path === "/api/dev/ai-status" && req.method === "GET") {
            const config = settings();
            res.writeHead(200, {
              "Content-Type": "application/json",
              "Cache-Control": "no-store",
            });
            res.end(
              JSON.stringify({
                configured: !!config.apiKey?.trim(),
                provider: "Gemini",
                model: config.model,
              }),
            );
            return;
          }
          if (req.method !== "POST")
            throw new BreakdownError(405, "Use POST to generate a breakdown.");
          if (!req.headers["content-type"]?.includes("application/json"))
            throw new BreakdownError(415, "Send a JSON request.");
          let raw = "";
          for await (const chunk of req) {
            raw += chunk.toString();
            if (raw.length > 12000)
              throw new BreakdownError(
                413,
                "The task description is too large.",
              );
          }
          let response: Response;
          if (path === "/api/dev/breakdown") {
            response = await authenticated(
              new Request(`http://${host}${path}`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: req.headers.authorization ?? "",
                },
                body: raw,
              }),
            );
          } else {
            let body;
            try {
              body = JSON.parse(raw);
            } catch {
              throw new BreakdownError(400, "Enter a valid task.");
            }
            const task = validateTask(body.task);
            if (playgroundActive)
              throw new BreakdownError(
                429,
                "A generation is already running. Please wait for it to finish.",
              );
            if (body.simulate === true) {
              const steps = allocateMinutes(
                [
                  { title: "[TEST] Review the task requirements", minutes: 15 },
                  {
                    title: "[TEST] Prepare the requested deliverable",
                    minutes: 45,
                  },
                  {
                    title: "[TEST] Check the result against the brief",
                    minutes: 15,
                  },
                ],
                task.personalized_hours,
              );
              const result: BreakdownResult = {
                steps,
                source: "mock",
                model: "simulated-test-fixture",
                total_minutes: steps.reduce((n, s) => n + s.minutes, 0),
              };
              response = jsonResponse(result);
            } else {
              playgroundActive = true;
              try {
                response = jsonResponse(await generate(task));
              } finally {
                playgroundActive = false;
              }
            }
          }
          // No CORS headers here: local endpoints are same-origin only.
          res.writeHead(response.status, {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
          });
          res.end(await response.text());
        } catch (error) {
          const status = error instanceof BreakdownError ? error.status : 500,
            message =
              error instanceof BreakdownError
                ? error.message
                : "The local test server could not complete the request.";
          res.writeHead(status, {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
          });
          res.end(JSON.stringify({ error: message }));
        }
      });
    },
  };
}
