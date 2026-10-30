import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("isMockWalletEnabled", () => {
  it.each([
    ["production", false],
    ["development", true],
    ["test", true],
  ])("NODE_ENV=%s: %s", async (nodeEnv, enabled) => {
    vi.stubEnv("NODE_ENV", nodeEnv);
    vi.resetModules();
    expect((await import("../mock-account")).isMockWalletEnabled).toBe(enabled);
  });
});
