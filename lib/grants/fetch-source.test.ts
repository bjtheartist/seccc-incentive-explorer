import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { fetchSource } from "./fetch-source";
const mocks = vi.hoisted(() => ({ request: vi.fn(), lookup: vi.fn() }));
vi.mock("node:https", () => ({ request: mocks.request }));
vi.mock("node:dns/promises", () => ({ lookup: mocks.lookup }));
beforeEach(() => {
  vi.resetAllMocks();
  mocks.lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
});
afterEach(() => vi.useRealTimers());
function setup(event: "large" | "aborted" | "close" | "normal") {
  const req = Object.assign(new EventEmitter(), {
    destroy: vi.fn(),
    end: () => {},
  });
  mocks.request.mockImplementation((_u, opts, receive) => {
    const cb = vi.fn();
    opts.lookup("example.org", { all: true }, cb);
    expect(cb).toHaveBeenCalledWith(null, [
      { address: "93.184.216.34", family: 4 },
    ]);
    req.end = () => {
      const res = Object.assign(new EventEmitter(), {
        statusCode: 200,
        headers: { "content-type": "text/html" },
        destroy: vi.fn(),
      });
      receive(res);
      if (event === "large") res.emit("data", Buffer.alloc(1_500_001));
      if (event === "aborted") res.emit("aborted");
      if (event === "close") req.emit("close");
      if (event === "normal") {
        res.emit("data", Buffer.from("valid page"));
        res.emit("end");
      }
    };
    return req;
  });
  return req;
}
it("pins the DNS address and supports Node's all-address lookup callback", async () => {
  setup("normal");
  expect((await fetchSource("https://example.org")).html).toBe("valid page");
});
it("settles immediately when the response is too large", async () => {
  setup("large");
  await expect(fetchSource("https://example.org")).rejects.toThrow("1.5 MB");
});
it("settles aborted bodies", async () => {
  setup("aborted");
  await expect(fetchSource("https://example.org")).rejects.toThrow(
    "interrupted",
  );
});
it("does not clear the deadline on an early request close", async () => {
  vi.useFakeTimers();
  setup("close");
  const promise = expect(fetchSource("https://example.org")).rejects.toThrow(
    "timed out",
  );
  await vi.advanceTimersByTimeAsync(10001);
  await promise;
});
it("blocks DNS rebinding to a private destination before HTTPS", async () => {
  mocks.lookup.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
  await expect(fetchSource("https://example.org")).rejects.toThrow(
    "non-public",
  );
  expect(mocks.request).not.toHaveBeenCalled();
});
