import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  // Playwright specs live in tests/e2e and run with `npm run test:e2e`.
  test: { exclude: [...configDefaults.exclude, "tests/e2e/**"] },
});
