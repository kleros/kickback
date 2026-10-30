// @vitest-environment node
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";

import { expect, it, vi } from "vitest";

const { request, lookup } = vi.hoisted(() => ({ request: vi.fn(), lookup: vi.fn() }));
vi.mock("node:https", () => ({ request }));
vi.mock("node:dns/promises", () => ({ lookup }));

import { previewTransport } from "../preview";

it("pins the connection while retaining TLS host verification and disables connection reuse", async () => {
  const res = Object.assign(Readable.from([Buffer.from("hello")]), {
    headers: { "content-type": "text/html" },
    statusCode: 200,
  });
  const req = Object.assign(new EventEmitter(), { end: vi.fn() });
  request.mockImplementation((_url, _options, callback) => {
    callback(res);
    return req;
  });
  const url = new URL("https://luma.com/event");
  const signal = new AbortController().signal;
  const response = await previewTransport.fetch(url, { address: "1.1.1.1", family: 4 }, signal);
  const [target, options] = request.mock.calls[0]!;
  expect(target).toBe(url);
  expect(options).toMatchObject({ agent: false, family: 4, signal, headers: { "Accept-Encoding": "identity" } });
  expect(options.rejectUnauthorized).not.toBe(false);
  const callback = vi.fn();
  options.lookup("luma.com", {}, callback);
  expect(callback).toHaveBeenCalledWith(null, "1.1.1.1", 4);
  expect(lookup).not.toHaveBeenCalled();
  expect(await response.text()).toBe("hello");
  expect(req.end).toHaveBeenCalledOnce();
});
it("requests all DNS answers, not just the first", async () => {
  lookup.mockResolvedValue([{ address: "1.1.1.1", family: 4 }]);
  await previewTransport.resolve("luma.com");
  expect(lookup).toHaveBeenCalledWith("luma.com", { all: true, verbatim: true });
});
