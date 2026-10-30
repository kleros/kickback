// @vitest-environment node
// importing @playwright/test under jsdom takes about two minutes
import { describe, expect, it } from "vitest";

import playwrightConfig from "../../../playwright.config";
import { assertHardhatNode, assertKickbackApp, E2E_APP_PORT, E2E_RPC_PORT } from "../servers";

describe("the servers the e2e suite runs against", () => {
  it("are started by the suite on ports of its own, never reused", () => {
    const servers = [playwrightConfig.webServer].flat();
    expect(servers).toHaveLength(2);
    for (const server of servers) expect(server?.reuseExistingServer).toBe(false);
    expect([E2E_APP_PORT, E2E_RPC_PORT]).not.toContain("3000");
    expect([E2E_APP_PORT, E2E_RPC_PORT]).not.toContain("8545");
  });

  it("a node that is not Hardhat's chain is refused", () => {
    expect(() => assertHardhatNode("http://127.0.0.1:8645", 31337)).not.toThrow();
    expect(() => assertHardhatNode("http://127.0.0.1:8645", 100)).toThrow(/answers as chainId 100/);
    expect(() => assertHardhatNode("http://127.0.0.1:8645", undefined)).toThrow(/answers as chainId nothing/);
  });

  it("an app that is not this one is refused", () => {
    expect(() => assertKickbackApp("http://localhost:3117", "<head><title>Kickback</title></head>")).not.toThrow();
    expect(() => assertKickbackApp("http://localhost:3000", "<title>Foresight | Kleros</title>")).toThrow(
      /title "Foresight \| Kleros", not "Kickback"/,
    );
    expect(() => assertKickbackApp("http://localhost:3000", undefined)).toThrow(/title null/);
  });
});
