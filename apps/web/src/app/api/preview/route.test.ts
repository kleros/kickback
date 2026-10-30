// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";

import { previewTransport } from "@/features/event/info/preview";

import { GET as getImage } from "./image/route";
import { GET, runtime } from "./route";

afterEach(() => vi.restoreAllMocks());
it("returns text metadata as JSON and rejects forbidden URLs without DNS", async () => {
  const dns = vi.spyOn(previewTransport, "resolve").mockResolvedValue([{ address: "1.1.1.1", family: 4 }]);
  vi.spyOn(previewTransport, "fetch").mockImplementation(
    async () => new Response("<title>&lt;b&gt;Dinner&lt;/b&gt;</title>", { headers: { "content-type": "text/html" } }),
  );
  expect(runtime).toBe("nodejs");
  const response = await GET(new Request("https://app.test/api/preview?url=https://luma.com/event"));
  expect(await response.json()).toEqual({
    title: "<b>Dinner</b>",
    description: "",
    siteName: "",
    image: null,
    host: "luma.com",
  });
  dns.mockClear();
  expect((await GET(new Request("https://app.test/api/preview?url=http://luma.com"))).status).toBe(400);
  expect(dns).not.toHaveBeenCalled();
});
it("serves images with restrictive headers on successes and failures", async () => {
  vi.spyOn(previewTransport, "resolve").mockResolvedValue([{ address: "1.1.1.1", family: 4 }]);
  vi.spyOn(previewTransport, "fetch").mockImplementation(
    async () => new Response("GIF89a", { headers: { "content-type": "image/gif" } }),
  );
  for (const url of ["https://luma.com/a.gif", "http://127.0.0.1"]) {
    const res = await getImage(new Request(`https://app.test/api/preview/image?url=${encodeURIComponent(url)}`));
    expect(res.headers.get("Content-Security-Policy")).toBe("default-src 'none'");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Cache-Control")).toBeTruthy();
    expect(res.status).toBe(url.startsWith("https") ? 200 : 400);
  }
});
