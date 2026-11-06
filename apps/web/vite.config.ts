import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  envDir: "../..",
  server: { port: 5173, host: true },
  preview: { port: 4173 },
  build: { target: "es2022", chunkSizeWarningLimit: 900 },
});
