// @vitest-environment node
import { expect, it, vi } from "vitest";

import config from "../../../next.config.mjs";

it("returns the app CSP, framing and referrer headers, including configured RPC origins", async () => {
  vi.stubEnv("NEXT_PUBLIC_MAINNET_RPC", "https://rpc.example.com/key");
  try {
    const rules = await config.headers!();
    const headers = Object.fromEntries(rules[0]!.headers.map((h) => [h.key, h.value]));
    const csp = headers["Content-Security-Policy"]!;
    expect(csp).toContain("frame-src https://www.google.com;");
    expect(csp).toContain("img-src 'self' data: blob: https://cdn.kleros.link;");
    for (const host of [
      "https://rpc.example.com",
      "https://rpc.mevblocker.io",
      "https://cdn.kleros.link",
      "https://kleros-api.netlify.app",
      "wss://*.walletconnect.com",
      "https://*.reown.com",
      "https://api.web3modal.org",
    ])
      expect(csp).toContain(host);
    expect(csp).not.toContain("/key");
    expect(csp).not.toContain("unsafe-eval");
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(rules[1]!.headers[0]!.value).toBe("default-src 'none'");
  } finally {
    vi.unstubAllEnvs();
  }
});
