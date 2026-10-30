import { afterEach, expect, it, vi } from "vitest";

import { createQr, downloadBlob, downloadQr } from "../qr";

const mocks = vi.hoisted(() => ({ constructor: vi.fn(), getRawData: vi.fn() }));
vi.mock("qr-code-styling", () => ({
  default: class {
    constructor(options: unknown) {
      mocks.constructor(options);
    }
    getRawData = mocks.getRawData;
  },
}));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.clearAllMocks();
});

it("loads the local logo, colours it, and uses data URI images allowed by CSP", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response('<svg fill="none"><path d="M0 0"/></svg>')),
  );
  await createQr("https://etherscan.io/tx/0x123", true);
  const options = mocks.constructor.mock.calls[0]![0];
  expect(atob(options.image.split(",")[1])).toContain('fill="#6c2ff2"');
  expect(options).toMatchObject({
    data: "https://etherscan.io/tx/0x123",
    type: "svg",
    qrOptions: { errorCorrectionLevel: "H" },
  });
});
it("rejects failed logo reads", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("", { status: 404 })),
  );
  await expect(createQr("hash", false)).rejects.toThrow("logo");
});
it("downloads a Blob through an attached anchor and revokes its object URL", () => {
  vi.useFakeTimers();
  const create = vi.fn(() => "blob:ticket"),
    revoke = vi.fn();
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = create;
      static revokeObjectURL = revoke;
    },
  );
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    expect(this.isConnected).toBe(true);
    expect(this.download).toBe("ticket.svg");
    expect(this.href).toBe("blob:ticket");
  });
  const blob = new Blob(["svg"], { type: "image/svg+xml" });
  downloadBlob(blob, "ticket.svg");
  expect(click).toHaveBeenCalledOnce();
  expect(create).toHaveBeenCalledWith(blob);
  expect(document.querySelector("a[download]")).toBeNull();
  vi.runAllTimers();
  expect(revoke).toHaveBeenCalledWith("blob:ticket");
});
it.each(["png", "svg"] as const)("exports %s at 1024 with a light background", async (extension) => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response('<svg fill="none"/>')),
  );
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = vi.fn(() => "blob:qr");
      static revokeObjectURL = vi.fn();
    },
  );
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  mocks.getRawData.mockResolvedValue(new Blob());
  await downloadQr("hash", extension);
  expect(mocks.getRawData).toHaveBeenCalledWith(extension);
  expect(mocks.constructor).toHaveBeenCalledWith(
    expect.objectContaining({ width: 1024, height: 1024, backgroundOptions: { color: "#ffffff" } }),
  );
  vi.runAllTimers();
});
