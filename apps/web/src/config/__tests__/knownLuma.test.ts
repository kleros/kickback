import { describe, expect, it } from "vitest";

import { knownLumaUrl, MAINNET_EVENT } from "../event";

describe("knownLumaUrl", () => {
  it("gives the live Truth Pays event its Luma page on mainnet only", () => {
    expect(knownLumaUrl(1, MAINNET_EVENT.contract)).toBe("https://luma.com/qewnqhas");
    expect(knownLumaUrl(1, MAINNET_EVENT.contract.toLowerCase() as `0x${string}`)).toBe("https://luma.com/qewnqhas");
    expect(knownLumaUrl(11155111, MAINNET_EVENT.contract)).toBeUndefined();
    expect(knownLumaUrl(1, "0x0000000000000000000000000000000000000001")).toBeUndefined();
  });
});
