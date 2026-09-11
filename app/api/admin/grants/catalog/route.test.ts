import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "./route";
const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  sql: vi.fn(),
  list: vi.fn(),
  get: vi.fn(),
  suggest: vi.fn(),
  promote: vi.fn(),
}));
vi.mock("@/lib/current-user", () => ({ getCurrentUserId: mocks.user }));
vi.mock("@/lib/db", () => ({ requireSQL: () => mocks.sql }));
vi.mock("@/lib/grants/catalog", () => ({
  GrantsCatalog: class {
    list = mocks.list;
    get = mocks.get;
    suggest = mocks.suggest;
    promote = mocks.promote;
  },
}));
const request = (query = "") =>
  new Request(`https://explorer.test/api/admin/grants/catalog${query}`);
const post = (origin = "https://explorer.test") =>
  new Request("https://explorer.test/api/admin/grants/catalog", {
    method: "POST",
    headers: { origin, "Content-Type": "application/json" },
    body: JSON.stringify({ id: "source" }),
  });
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("GRANTS_OWNER_USER_ID", "owner");
  mocks.user.mockResolvedValue("staff");
  mocks.sql.mockResolvedValue([
    { id: "staff", name: "Staff", role: "editor", active: true },
  ]);
  mocks.list.mockResolvedValue({ items: [], total: 0 });
  mocks.promote.mockResolvedValue({ programId: "p", roundId: "r" });
});
describe("funding database staff boundary", () => {
  it("denies anonymous catalog, detail and questionnaire queries before reading source data", async () => {
    mocks.user.mockResolvedValue(null);
    for (const q of ["", "?id=source", "?applicantId=private-profile"])
      expect((await GET(request(q))).status).toBe(403);
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.get).not.toHaveBeenCalled();
    expect(mocks.suggest).not.toHaveBeenCalled();
  });
  it("allows viewer reads but denies source promotion", async () => {
    mocks.sql.mockResolvedValue([
      { id: "staff", role: "viewer", active: true },
    ]);
    const res = await GET(request());
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect((await POST(post())).status).toBe(403);
    expect(mocks.promote).not.toHaveBeenCalled();
  });
  it("allows editors to start a review only from a same-origin request", async () => {
    expect((await POST(post("https://foreign.example"))).status).toBe(403);
    expect((await POST(post())).status).toBe(200);
    expect(mocks.promote).toHaveBeenCalledTimes(1);
  });
  it("rejects ordinary accounts and invalid pagination", async () => {
    expect((await GET(request("?page=999999"))).status).toBe(400);
    mocks.sql.mockResolvedValue([{ id: "staff", active: null }]);
    expect((await GET(request())).status).toBe(403);
  });
});
