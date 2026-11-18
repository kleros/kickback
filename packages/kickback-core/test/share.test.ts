import { describe, expect, it } from "vitest";

import { fillShare, validateShare } from "../src";

const details = {
  event: "Dinner 🎉 & friends",
  date: "4 Nov",
  venue: "Mumbai",
  luma: "https://luma.com/dinner?a=1&b=2",
  guestLink: "https://kickback.test/event/0x123",
};

describe("share templates", () => {
  it("fills only the supported placeholders, without recursively filling values", () => {
    expect(fillShare("{event} | {date} | {venue} | {luma} | {guestLink}", details)).toBe(
      Object.values(details).join(" | "),
    );
    expect(fillShare("{event}", { ...details, event: "{venue}" })).toBe("{venue}");
  });
  it("uses a default for missing or blank templates and falls back to the guest link", () => {
    expect(fillShare(undefined, details)).toContain(details.luma);
    expect(fillShare("  ", details)).toEqual(fillShare(undefined, details));
    expect(fillShare(undefined, { ...details, luma: "" })).toContain(details.guestLink);
  });
  it.each(["{unknown}", "{{event}}", "{event", "event}", "{}", "<b>hello</b>", "a\n", "x\u202e", "x".repeat(281), 42])(
    "rejects invalid template %s",
    (share) => {
      expect(() => validateShare(share)).toThrow();
    },
  );
  it("keeps 280 characters intact, including emoji", () => {
    const template = "🎉".repeat(280);
    expect(validateShare(template)).toBe(template);
    expect(fillShare(template, details)).toBe(template);
  });
  it("caps expansion while keeping both links whole and no orphan surrogate", () => {
    const filled = fillShare("{event} {luma} {guestLink}", { ...details, event: "🎉 dinner ".repeat(100) });
    expect(Array.from(filled).length).toBeLessThanOrEqual(280);
    expect(filled).toContain(details.luma);
    expect(filled).toContain(details.guestLink);
    expect(filled).toContain("…");
    expect(filled).not.toMatch(/[\p{Cs}]/u);
  });
  it("omits an oversized URL instead of producing a partial address", () => {
    const luma = `https://luma.com/${"x".repeat(300)}`;
    const filled = fillShare("{event} {luma}", { ...details, luma });
    expect(filled.length).toBeLessThanOrEqual(280);
    expect(filled).not.toContain("https:");
  });
});
