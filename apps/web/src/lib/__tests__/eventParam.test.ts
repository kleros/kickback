import { describe, expect, it } from "vitest";

import { cleanEventParam } from "../eventParam";

const A = "0xA14d9C7a916Db01cCA55ec21Be1F7665C326928F";

describe("cleanEventParam", () => {
  it("strips what a copied link picks up around the address", () => {
    for (const raw of [`${A}%20`, `${A}.`, `${A})`, `(${A})`, `%3C${A}%3E`, ` ${A} `])
      expect(cleanEventParam(raw)).toBe(A);
  });
  it("accepts an upper-case 0X prefix, as some keyboards type it", () => {
    expect(cleanEventParam(`0X${A.slice(2)}`)).toBe(A);
    expect(cleanEventParam(`(0X${A.slice(2)}).`)).toBe(A);
    expect(cleanEventParam(`0X${A.slice(2)}a`)).toBe(`0X${A.slice(2)}a`);
  });

  it("keeps anything that is not exactly one address as it is", () => {
    expect(cleanEventParam(`${A}a`)).toBe(`${A}a`);
    expect(cleanEventParam(A.slice(0, 41))).toBe(A.slice(0, 41));
    expect(cleanEventParam("%E0")).toBe("%E0");
  });
});
