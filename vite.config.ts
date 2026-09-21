import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { aiDevPlugin } from "./scripts/ai-dev";
export default defineConfig({
  plugins: [react(), aiDevPlugin()],
  server: { port: 5173, strictPort: true },
  build: {
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          supabase: ["@supabase/supabase-js"],
          vendor: [
            "react",
            "react-dom",
            "react-router-dom",
            "@tanstack/react-query",
          ],
        },
      },
    },
  },
});
