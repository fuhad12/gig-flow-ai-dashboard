import { defineConfig } from "vitest/config"
import path from "node:path"

/**
 * Vitest configuration.
 *
 * - `node` environment by default; the LLM/validator helpers are
 *   server-only so we don't need jsdom for them. Tests that DO want a
 *   DOM can opt in with `// @vitest-environment jsdom`.
 * - `@/` alias mirrors the Next.js / tsconfig paths.
 * - Coverage is opt-in (`npm run test:coverage`) and uses v8.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    globals: false,
    reporters: ["default"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["lib/**/*.ts"],
      exclude: [
        "lib/**/*.d.ts",
        "lib/supabase/**",
        "lib/stripe.ts",
        "lib/openai.ts",
      ],
    },
  },
})
