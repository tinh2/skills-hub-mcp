import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The installer tests mock node:fs; inline the @skills-hub-ai packages so
    // the mock also applies to the fs calls they make.
    server: { deps: { inline: [/@skills-hub-ai\//] } },
  },
});
