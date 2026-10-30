import { describe, expect, it } from "vitest";

import { mapQuery, venueMap } from "../event-details";

describe("mapQuery", () => {
  it("searches the planned venue inside a sentence, and plain venues as they are", () => {
    const live = "the venue announced to registered guests on Luma (planned: Hitchki, Bandra Kurla Complex (BKC), Mumbai)";
    expect(mapQuery(live)).toBe("Hitchki, Bandra Kurla Complex (BKC), Mumbai");
    expect(mapQuery("Bangalore International Centre, Domlur")).toBe("Bangalore International Centre, Domlur");
    expect(venueMap(live)).toContain("q=Hitchki");
  });
});
