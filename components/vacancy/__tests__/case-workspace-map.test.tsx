// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { VacancyCaseRecord } from "@/lib/vacancy-cases";

const mapbox = vi.hoisted(() => {
  const layers = new Map<string, Record<string, unknown>>();
  const sources = new Map<string, { setData: ReturnType<typeof vi.fn> }>();
  return {
    layers,
    sources,
    configs: [] as Array<Record<string, unknown>>,
    addControl: vi.fn(),
    addLayer: vi.fn(),
    addSource: vi.fn(),
    easeTo: vi.fn(),
    fitBounds: vi.fn(),
    remove: vi.fn(),
    setFilter: vi.fn(),
    setLayoutProperty: vi.fn(),
  };
});

vi.mock("mapbox-gl", () => {
  class MapMock {
    constructor(config: Record<string, unknown>) {
      mapbox.configs.push(config);
    }

    addControl(control: unknown, position: string) {
      mapbox.addControl(control, position);
    }

    addSource(id: string, specification: Record<string, unknown>) {
      const source = { setData: vi.fn() };
      mapbox.sources.set(id, source);
      mapbox.addSource(id, specification);
    }

    addLayer(layer: Record<string, unknown>, beforeId?: string) {
      mapbox.layers.set(layer.id as string, layer);
      mapbox.addLayer(layer, beforeId);
    }

    getSource(id: string) {
      return mapbox.sources.get(id);
    }

    getLayer(id: string) {
      return mapbox.layers.get(id);
    }

    getZoom() {
      return 12;
    }

    getBounds() {
      return null;
    }

    getCanvas() {
      return { style: { cursor: "" } };
    }

    queryRenderedFeatures() {
      return [];
    }

    on(event: string, layerOrHandler: string | (() => void), maybeHandler?: () => void) {
      const handler = typeof layerOrHandler === "function" ? layerOrHandler : maybeHandler;
      if (event === "load" && handler) queueMicrotask(handler);
    }

    once(event: string, handler: () => void) {
      if (event === "idle") queueMicrotask(handler);
    }

    fitBounds(bounds: unknown, options: unknown, eventData?: unknown) {
      mapbox.fitBounds(bounds, options, eventData);
    }

    easeTo(options: unknown, eventData?: unknown) {
      mapbox.easeTo(options, eventData);
    }

    setFilter(layer: string, filter: unknown) {
      mapbox.setFilter(layer, filter);
    }

    setLayoutProperty(layer: string, property: string, value: string) {
      mapbox.setLayoutProperty(layer, property, value);
    }

    isStyleLoaded() {
      return true;
    }

    resize() {}

    remove() {
      mapbox.remove();
    }
  }

  class PopupMock {
    setLngLat() {
      return this;
    }
    setHTML() {
      return this;
    }
    addTo() {
      return this;
    }
    remove() {
      return this;
    }
  }

  return {
    default: {
      accessToken: "",
      Map: MapMock,
      NavigationControl: class NavigationControlMock {},
      Popup: PopupMock,
    },
  };
});

import CaseWorkspaceMap, {
  selectedRecordCamera,
} from "@/components/vacancy/CaseWorkspaceMap";

const record: VacancyCaseRecord = {
  id: "record-1",
  address: "8154 S CORNELL AVE",
  pin: "20-36-111-054-0000",
  universe: "land",
  ownerType: "city_public",
  ownerStructure: null,
  ownerGeography: null,
  saleYear: null,
  violation: false,
  squareFeet: null,
  lat: 41.7462,
  lon: -87.5835,
};

const filteredRecords: VacancyCaseRecord[] = [
  { ...record, id: "record-2", address: "9000 S COMMERCIAL AVE", lat: 41.731, lon: -87.551 },
  { ...record, id: "record-3", address: "9500 S EWING AVE", lat: 41.721, lon: -87.536 },
];

function renderMap(selectedId: string | null = null) {
  return render(
    <CaseWorkspaceMap
      zip="60617"
      records={[record]}
      selectedId={selectedId}
      boundary={{
        rings: [],
        bbox: [-87.62, 41.72, -87.52, 41.78],
      }}
      centroid={{ lat: 41.75, lon: -87.57 }}
      committedBounds={null}
      onSelect={vi.fn()}
      onCandidateBounds={vi.fn()}
    />,
  );
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_MAPBOX_TOKEN = "test-token";
  window.sessionStorage.clear();
  mapbox.layers.clear();
  mapbox.sources.clear();
  mapbox.configs.length = 0;
  vi.clearAllMocks();
  vi.stubGlobal(
    "ResizeObserver",
    class ResizeObserverMock {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ points: [{ name: "Bessemer Park", lat: 41.73, lon: -87.57 }] }),
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
});

describe("CaseWorkspaceMap camera and controls", () => {
  it("zooms an inspected record past the cluster threshold without zooming out", () => {
    expect(selectedRecordCamera(record, 12)).toEqual({
      center: [-87.5835, 41.7462],
      zoom: 16,
      duration: 350,
    });
    expect(selectedRecordCamera(record, 17)?.zoom).toBe(17);
    expect(selectedRecordCamera({ ...record, lat: null, lon: null }, 12)).toBeNull();
  });

  it("enables wheel zoom, keeps controls clear of the layers, and zooms a selection", async () => {
    const rendered = renderMap();

    await waitFor(() => expect(mapbox.configs).toHaveLength(1));
    expect(mapbox.configs[0]).toEqual(expect.objectContaining({ scrollZoom: true }));
    expect(mapbox.addControl).toHaveBeenCalledWith(expect.anything(), "top-left");
    expect(screen.getByRole("button", { name: "Map layers" }).getAttribute("aria-expanded")).toBe(
      "false",
    );
    expect(screen.getByTestId("case-workspace-mobile-layer-control").className).toContain("top-14");
    expect(screen.getByTestId("case-workspace-mobile-layer-control").className).toContain("md:hidden");

    mapbox.easeTo.mockClear();
    rendered.rerender(
      <CaseWorkspaceMap
        zip="60617"
        records={[record]}
        selectedId="record-1"
        boundary={{ rings: [], bbox: [-87.62, 41.72, -87.52, 41.78] }}
        centroid={{ lat: 41.75, lon: -87.57 }}
        committedBounds={null}
        onSelect={vi.fn()}
        onCandidateBounds={vi.fn()}
      />,
    );

    await waitFor(() =>
      expect(mapbox.easeTo).toHaveBeenCalledWith(
        {
          center: [-87.5835, 41.7462],
          zoom: 16,
          duration: 350,
        },
        { cieProgrammaticMove: true },
      ),
    );
  });

  it("refits the camera to the currently filtered records", async () => {
    const rendered = renderMap();

    await waitFor(() => expect(mapbox.fitBounds).toHaveBeenCalled());
    mapbox.fitBounds.mockClear();

    rendered.rerender(
      <CaseWorkspaceMap
        zip="60617"
        records={filteredRecords}
        selectedId={null}
        boundary={{ rings: [], bbox: [-87.62, 41.72, -87.52, 41.78] }}
        centroid={{ lat: 41.75, lon: -87.57 }}
        committedBounds={null}
        onSelect={vi.fn()}
        onCandidateBounds={vi.fn()}
      />,
    );

    await waitFor(() =>
      expect(mapbox.fitBounds).toHaveBeenCalledWith(
        [
          [-87.551, 41.721],
          [-87.536, 41.731],
        ],
        { padding: 28, duration: 300, maxZoom: 16 },
        { cieProgrammaticMove: true },
      ),
    );
  });

  it("renders the seven Site Matchmaker layers off by default and lazy-loads once", async () => {
    renderMap();

    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes).toHaveLength(7);
    expect(checkboxes.every((checkbox) => !(checkbox as HTMLInputElement).checked)).toBe(true);

    const parks = screen.getByRole("checkbox", { name: "Parks" });
    fireEvent.click(parks);

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith("/data/park-points.json", { cache: "force-cache" }),
    );
    await waitFor(() =>
      expect(mapbox.addLayer).toHaveBeenCalledWith(
        expect.objectContaining({ id: "shortlist-infra-parks-dot" }),
        "case-workspace-clusters",
      ),
    );
    expect(JSON.parse(window.sessionStorage.getItem("cie_shortlist_infrastructure_layers") ?? "{}").parks).toBe(
      true,
    );

    fireEvent.click(parks);
    await waitFor(() =>
      expect(mapbox.setLayoutProperty).toHaveBeenCalledWith(
        "shortlist-infra-parks-dot",
        "visibility",
        "none",
      ),
    );
    fireEvent.click(parks);
    await waitFor(() =>
      expect(mapbox.setLayoutProperty).toHaveBeenCalledWith(
        "shortlist-infra-parks-dot",
        "visibility",
        "visible",
      ),
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("finishes an enabled layer load when another toggle changes mid-flight", async () => {
    let resolveParks!: (value: { ok: boolean; json: () => Promise<unknown> }) => void;
    const parksResponse = new Promise<{ ok: boolean; json: () => Promise<unknown> }>((resolve) => {
      resolveParks = resolve;
    });
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation((input) => {
      if (input === "/data/park-points.json") return parksResponse as Promise<Response>;
      return Promise.resolve({
        ok: true,
        json: async () => ({ points: [{ name: "Vodak-East Side Library", lat: 41.708, lon: -87.535 }] }),
      }) as Promise<Response>;
    });

    renderMap();
    fireEvent.click(screen.getByRole("checkbox", { name: "Parks" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/data/park-points.json", { cache: "force-cache" }));

    fireEvent.click(screen.getByRole("checkbox", { name: "Libraries" }));
    resolveParks({
      ok: true,
      json: async () => ({ points: [{ name: "Bessemer Park", lat: 41.73, lon: -87.57 }] }),
    });

    await waitFor(() =>
      expect(mapbox.addLayer).toHaveBeenCalledWith(
        expect.objectContaining({ id: "shortlist-infra-parks-dot" }),
        "case-workspace-clusters",
      ),
    );
    expect(screen.getByRole("checkbox", { name: "Parks" })).toHaveProperty("checked", true);
  });
});
