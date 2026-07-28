import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Resolves the "@/*" alias straight from tsconfig.json.
    tsconfigPaths: true,
  },
  test: {
    // Most units are server-side. Component tests opt into jsdom with a
    // `@vitest-environment jsdom` docblock.
    environment: "node",
    include: ["tests/**/*.test.{ts,tsx}"],
    restoreMocks: true,
    setupFiles: ["tests/setup.ts"],
  },
});
