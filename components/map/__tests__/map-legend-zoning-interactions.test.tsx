// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { ZONE_KEYS, VACANT_LABELS, ZONING_CATEGORIES } from "@/lib/constants";
import MapLegendPanel from "../MapLegendPanel";
import { POI_LAYERS } from "../map-helpers";
import { mapZoningFamilyVisibility } from "../zoning-map-filter";

const SOURCE_CLASSES = [
  "B1-2",
  "C1-1",
  "C1-2",
  "RS-2",
  "RM4.5",
  "RM-4.5",
  "PD 123",
  "PMD 4",
];

afterEach(cleanup);

function ZoningHarness() {
  const [family, setFamily] = useState("");
  const [districtType, setDistrictType] = useState("");
  const [exactCode, setExactCode] = useState("");
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [zoningVisible, setZoningVisible] = useState<Record<string, boolean>>(
    mapZoningFamilyVisibility(ZONING_CATEGORIES, ""),
  );

  function clearLinkedFocus() {
    setFamily("");
    setDistrictType("");
    setExactCode("");
  }

  return (
    <>
      <output data-testid="active-preset">{activePreset ?? "none"}</output>
      <MapLegendPanel
        zoneVisible={Object.fromEntries(ZONE_KEYS.map((key) => [key, false]))}
        poiVisible={Object.fromEntries(Object.keys(POI_LAYERS).map((key) => [key, false]))}
        zoningVisible={zoningVisible}
        zoningDistrictClasses={SOURCE_CLASSES}
        zoningLayerStatus="available"
        zoningFamilyFilter={family}
        zoningDistrictTypeFilter={districtType}
        zoningExactCodeFilter={exactCode}
        vacantVisible={Object.fromEntries(
          Object.keys(VACANT_LABELS).map((key) => [key, false]),
        )}
        parcelsVisible={false}
        ownerFilter="all"
        expandedZone={null}
        zoningRefOpen={false}
        classRefOpen={false}
        inspectMode={false}
        activePreset={activePreset}
        adminSessionActive={false}
        ownerClustersVisible={false}
        onClose={() => {}}
        onToggleZone={() => {}}
        onTogglePoi={() => {}}
        onToggleZoningCategory={(categoryKey) => {
          clearLinkedFocus();
          setActivePreset(null);
          setZoningVisible((current) => ({
            ...current,
            [categoryKey]: !current[categoryKey],
          }));
        }}
        onToggleAllZoning={() => {
          clearLinkedFocus();
          setActivePreset(null);
          setZoningVisible((current) => {
            const next = !Object.values(current).some(Boolean);
            return Object.fromEntries(ZONING_CATEGORIES.map((category) => [category.key, next]));
          });
        }}
        onSetZoningFamilyFilter={(value) => {
          setFamily(value);
          setDistrictType("");
          setExactCode("");
          setActivePreset(null);
          setZoningVisible(mapZoningFamilyVisibility(ZONING_CATEGORIES, value));
        }}
        onSetZoningDistrictTypeFilter={(value) => {
          setDistrictType(value);
          setExactCode("");
          setActivePreset(null);
        }}
        onSetZoningExactCodeFilter={(value) => {
          setExactCode(value);
          setActivePreset(null);
        }}
        onSetVacantVisible={() => {}}
        onSetParcelsVisible={() => {}}
        onSetOwnerFilter={() => {}}
        onSetExpandedZone={() => {}}
        onSetZoningRefOpen={() => {}}
        onSetClassRefOpen={() => {}}
        onSetInspectMode={() => {}}
        onApplyPreset={(presetId) => {
          setActivePreset(presetId);
          clearLinkedFocus();
          if (presetId === "zoning") {
            setZoningVisible(mapZoningFamilyVisibility(ZONING_CATEGORIES, ""));
          } else if (presetId === "city") {
            setZoningVisible(
              Object.fromEntries(ZONING_CATEGORIES.map((category) => [category.key, false])),
            );
          }
        }}
        onSetOwnerClustersVisible={() => {}}
      />
    </>
  );
}

describe("MapLegendPanel zoning interactions", () => {
  it("cascades family, type, and exact choices and clears child selections", () => {
    render(<ZoningHarness />);
    const family = screen.getByLabelText("Zoning family") as HTMLSelectElement;
    const type = screen.getByLabelText("District type") as HTMLSelectElement;
    const exact = screen.getByLabelText("Exact published code") as HTMLSelectElement;

    expect(type.disabled).toBe(true);
    expect(exact.disabled).toBe(true);

    fireEvent.change(family, { target: { value: "commercial" } });
    expect(family.value).toBe("commercial");
    expect(type.disabled).toBe(false);
    expect((screen.getByRole("checkbox", { name: /Business\/Commercial/ }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("checkbox", { name: /^Residential/ }) as HTMLInputElement).checked).toBe(false);

    fireEvent.change(type, { target: { value: "C1" } });
    expect(type.value).toBe("C1");
    expect(exact.disabled).toBe(false);
    fireEvent.change(exact, { target: { value: "C1-1" } });
    expect(exact.value).toBe("C1-1");

    fireEvent.change(family, { target: { value: "residential" } });
    expect(type.value).toBe("");
    expect(exact.value).toBe("");
    expect(exact.disabled).toBe(true);
  });

  it("keeps source aliases under one canonical exact choice", () => {
    render(<ZoningHarness />);
    fireEvent.change(screen.getByLabelText("Zoning family"), {
      target: { value: "residential" },
    });
    fireEvent.change(screen.getByLabelText("District type"), { target: { value: "RM" } });

    const exact = screen.getByLabelText("Exact published code") as HTMLSelectElement;
    const rmOptions = within(exact).getAllByRole("option").filter(
      (option) => (option as HTMLOptionElement).value === "RM-4.5",
    );
    expect(rmOptions).toHaveLength(1);
    expect(rmOptions[0].textContent).toContain("RM-4.5");
  });

  it("stops PD at type-level and presents a truthful ordinance handoff", () => {
    render(<ZoningHarness />);
    fireEvent.change(screen.getByLabelText("Zoning family"), { target: { value: "pd" } });
    fireEvent.change(screen.getByLabelText("District type"), { target: { value: "PD" } });

    const exact = screen.getByLabelText("Exact published code") as HTMLSelectElement;
    expect(exact.disabled).toBe(true);
    expect(exact.value).toBe("");
    expect(screen.getByText(/Confirm the governing ordinance with the City/)).toBeTruthy();
  });

  it("clears a highlighted preset when linked or manual zoning controls take over", () => {
    render(<ZoningHarness />);
    fireEvent.click(screen.getByRole("button", { name: "Zoning" }));
    expect(screen.getByTestId("active-preset").textContent).toBe("zoning");

    fireEvent.change(screen.getByLabelText("Zoning family"), {
      target: { value: "commercial" },
    });
    expect(screen.getByTestId("active-preset").textContent).toBe("none");

    fireEvent.click(screen.getAllByRole("button", { name: "City" })[0]);
    expect(screen.getByTestId("active-preset").textContent).toBe("city");
    fireEvent.click(screen.getByRole("checkbox", { name: /^Residential/ }));
    expect(screen.getByTestId("active-preset").textContent).toBe("none");
    expect((screen.getByLabelText("Zoning family") as HTMLSelectElement).value).toBe("");
  });

  it("preserves manual subsets and supports hide-all/show-all", () => {
    render(<ZoningHarness />);
    fireEvent.change(screen.getByLabelText("Zoning family"), {
      target: { value: "commercial" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: /^Residential/ }));
    expect((screen.getByRole("checkbox", { name: /^Residential/ }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("checkbox", { name: /Business\/Commercial/ }) as HTMLInputElement).checked).toBe(true);

    const zoningCheckboxes = () =>
      ZONING_CATEGORIES.map((category) =>
        screen.getByRole("checkbox", { name: new RegExp(`^${category.label}`) }),
      );
    fireEvent.click(screen.getByRole("button", { name: "Hide all" }));
    for (const checkbox of zoningCheckboxes()) {
      expect((checkbox as HTMLInputElement).checked).toBe(false);
    }
    fireEvent.click(screen.getByRole("button", { name: "Show all" }));
    for (const checkbox of zoningCheckboxes()) {
      expect((checkbox as HTMLInputElement).checked).toBe(true);
    }
  });
});
