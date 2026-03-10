import { defineConfig } from "@playwright/test";

export default defineConfig({
    testDir: "tests/e2e",
    timeout: 60_000,
    expect: { timeout: 10_000 },
    use: {
        headless: true,
        viewport: { width: 1280, height: 800 },
        baseURL: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
    },
});
