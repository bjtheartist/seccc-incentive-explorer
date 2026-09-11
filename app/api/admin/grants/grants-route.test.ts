import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "./[resource]/route";
const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  sql: vi.fn(),
  workspace: vi.fn(),
  save: vi.fn(),
  scan: vi.fn(),
}));
vi.mock("@/lib/current-user", () => ({ getCurrentUserId: mocks.user }));
vi.mock("@/lib/db", () => ({ requireSQL: () => mocks.sql }));
vi.mock("@/lib/grants/store", () => ({
  GrantsStore: class {
    workspace = mocks.workspace;
    save = mocks.save;
  },
  query: vi.fn(),
}));
vi.mock("@/lib/grants/scanner", () => ({ scanSources: mocks.scan }));
const context = (resource: string) => ({
  params: Promise.resolve({ resource }),
});
const request = (body: unknown = {}, origin = "https://explorer.test") =>
  new Request("https://explorer.test/api/admin/grants/programs", {
    method: "POST",
    headers: { origin, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("GRANTS_OWNER_USER_ID", "owner");
  mocks.user.mockResolvedValue("staff");
  mocks.sql.mockResolvedValue([
    {
      id: "staff",
      name: "Staff",
      email: "staff@example.org",
      role: "editor",
      active: true,
    },
  ]);
  mocks.workspace.mockResolvedValue({ programs: [] });
});
describe("staff authorization on every route", () => {
  it("denies anonymous users before reading the database", async () => {
    mocks.user.mockResolvedValue(null);
    expect(
      (
        await GET(
          new Request("https://explorer.test/api/admin/grants/workspace"),
          context("workspace"),
        )
      ).status,
    ).toBe(403);
    expect(mocks.workspace).not.toHaveBeenCalled();
  });
  it("denies ordinary signed-in accounts and public access cookies", async () => {
    mocks.sql.mockResolvedValue([{ id: "staff", active: null }]);
    const req = new Request("https://explorer.test/api/admin/grants/export", {
      headers: { cookie: "cie_shortlist_access=anything" },
    });
    expect((await GET(req, context("export"))).status).toBe(403);
  });
  it("permits viewer reads but not writes or scans", async () => {
    mocks.sql.mockResolvedValue([
      { id: "staff", role: "viewer", active: true },
    ]);
    const res = await GET(
      new Request("https://explorer.test/api/admin/grants/workspace"),
      context("workspace"),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect((await POST(request(), context("scan"))).status).toBe(403);
    expect(mocks.scan).not.toHaveBeenCalled();
  });
  it("rejects cross-site mutations", async () => {
    expect(
      (await POST(request({}, "https://attacker.test"), context("programs")))
        .status,
    ).toBe(403);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("does not let editors manage access", async () =>
    expect((await POST(request({}), context("members"))).status).toBe(403));
  it("rejects prototype names and invalid payloads", async () => {
    expect((await POST(request(), context("constructor"))).status).toBe(404);
    expect(
      (await POST(request({ data: null }), context("programs"))).status,
    ).toBe(400);
    expect(mocks.save).not.toHaveBeenCalled();
  });
});
