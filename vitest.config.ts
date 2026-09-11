import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "react",
  },

  test: {
    include: ["test/**/*.test.{ts,tsx}"],
    environment: "node",
  },
});