// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import WardSnapshotTable from "@/components/wards/WardSnapshotTable";
import type { WardSnapshotFile } from "@/lib/ward-snapshot";
import snapshotJson from "@/public/data/ward-snapshot.json";

const snapshot = snapshotJson as WardSnapshotFile;

const rowWards = () =>
  screen
    .getAllByRole("rowheader")
    .map((th) => Number(th.textContent));

afterEach(cleanup);

describe("WardSnapshotTable filtering and ranking", () => {
  it("starts with all 50 wards in ward-number order", () => {
    render(<WardSnapshotTable snapshot={snapshot} />);
    expect(rowWards()).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
    expect(screen.getByText(/of 50 wards/).textContent).toContain("Showing 50 of 50 wards");
  });

  it("finds a ward by number or by neighborhood", () => {
    render(<WardSnapshotTable snapshot={snapshot} />);
    const search = screen.getByPlaceholderText("Ward number or neighborhood");
    fireEvent.change(search, { target: { value: "24" } });
    expect(rowWards()).toEqual([24]);
    fireEvent.change(search, { target: { value: "lawndale" } });
    expect(rowWards()).toContain(24);
    fireEvent.change(search, { target: { value: "zzzz" } });
    expect(screen.getByText("No wards match these filters.")).toBeTruthy();
  });

  it("ranks by youth poverty, highest first, and flips to lowest first", () => {
    render(<WardSnapshotTable snapshot={snapshot} />);
    fireEvent.change(screen.getByLabelText("Rank by"), { target: { value: "youthPovertyRate" } });
    const highestFirst = rowWards();
    const rate = (w: number) => snapshot.wards.find((x) => x.ward === w)!.values.youthPovertyRate!;
    expect(rate(highestFirst[0])).toBe(Math.max(...snapshot.wards.map((w) => w.values.youthPovertyRate!)));
    expect(rate(highestFirst[0])).toBeGreaterThan(rate(highestFirst[49]));
    fireEvent.change(screen.getByLabelText("Order"), { target: { value: "asc" } });
    expect(rowWards()[0]).toBe(highestFirst[49]);
  });

  it("filters to a tier on one measure", () => {
    render(<WardSnapshotTable snapshot={snapshot} />);
    const fieldset = screen.getByRole("group", { name: "Filter by tier" });
    fireEvent.change(within(fieldset).getByLabelText("Vacant Lots"), { target: { value: "Very High" } });
    expect(rowWards()).toHaveLength(10);
    expect(screen.getByText(/of 50 wards/).textContent).toContain("Showing 10 of 50 wards");
  });

  it("High-need preset keeps only wards with high youth poverty and a low tax base, neediest first", () => {
    render(<WardSnapshotTable snapshot={snapshot} />);
    fireEvent.click(screen.getByRole("button", { name: "High-need wards" }));
    const wards = rowWards();
    expect(wards.length).toBeGreaterThan(0);
    expect(wards.length).toBeLessThan(50);
    expect(wards).toEqual(expect.arrayContaining([20, 24, 16]));
    expect(wards).not.toContain(42);
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(rowWards()).toHaveLength(50);
  });

  it("High-wealth preset surfaces the downtown and north lakefront wards", () => {
    render(<WardSnapshotTable snapshot={snapshot} />);
    fireEvent.click(screen.getByRole("button", { name: "High-wealth wards" }));
    const wards = rowWards();
    expect(wards).toEqual(expect.arrayContaining([42, 2, 43, 44]));
    expect(wards).not.toContain(20);
  });
});
