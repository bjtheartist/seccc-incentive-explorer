// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock }) }));

import { SavePermitExhibitSnapshotButton } from "../SavePermitExhibitSnapshotButton";

const PROPS = {
  pin: "17091190280000",
  radiusFt: 500,
  requestId: "35d9a3a4-d98a-4f49-9f95-f86b5a41bfb0",
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SavePermitExhibitSnapshotButton", () => {
  it("posts only the server-authorized query fields and navigates to the saved URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ url: "/permit-exhibit/snapshots/ps_abcdefghijklmnopqrstuvwx" }),
        { status: 201, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<SavePermitExhibitSnapshotButton {...PROPS} />);

    fireEvent.click(screen.getByRole("button", { name: "Save read-only snapshot" }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledOnce();
    const [path, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe("/api/permit-exhibit-snapshots");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(String(init.body))).toEqual(PROPS);
    expect(pushMock).toHaveBeenCalledWith(
      "/permit-exhibit/snapshots/ps_abcdefghijklmnopqrstuvwx",
    );
  });

  it("disables duplicate submission while a save is pending", async () => {
    let finish!: (value: Response) => void;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<SavePermitExhibitSnapshotButton {...PROPS} />);

    const button = screen.getByRole("button", { name: "Save read-only snapshot" });
    fireEvent.click(button);
    expect(screen.getByRole("button", { name: "Saving snapshot…" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Saving snapshot…" }));
    expect(fetchMock).toHaveBeenCalledOnce();

    finish(
      new Response(
        JSON.stringify({ url: "/permit-exhibit/snapshots/ps_abcdefghijklmnopqrstuvwx" }),
        { status: 201, headers: { "content-type": "application/json" } },
      ),
    );
    await waitFor(() => expect(pushMock).toHaveBeenCalledOnce());
  });

  it.each([401, 429, 503])("shows the API recovery message and re-enables after status %i", async (status) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: `Recoverable ${status}` }), {
          status,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    render(<SavePermitExhibitSnapshotButton {...PROPS} />);

    fireEvent.click(screen.getByRole("button", { name: "Save read-only snapshot" }));

    expect((await screen.findByRole("alert")).textContent).toContain(`Recoverable ${status}`);
    expect(screen.getByRole("button", { name: "Save read-only snapshot" }).hasAttribute("disabled")).toBe(false);
    expect(pushMock).not.toHaveBeenCalled();
  });
});
