import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import MapLegendPanel from "../MapLegendPanel";
import { ZONE_KEYS, VACANT_LABELS, ZONING_CATEGORIES } from "@/lib/constants";
import { POI_LAYERS } from "../map-helpers";
import { OWNER_TYPE_LABELS, presentOwnerTypesInOrder } from "@/lib/owner-classify";
import { ZONE_LAYER_PRESETS } from "../map-layer-presets";

/**
 * The ADMIN ownership-cluster legend section is probe-driven
 * (components/map/MapView.tsx probes /api/owner-file/session once on mount
 * and passes the result in as adminSessionActive) — it must never render for
 * a non-admin visitor, and must render with the "Ownership clusters" toggle
 * defaulted OFF when it does.
 */
function baseProps() {
  return {
    zoneVisible: Object.fromEntries(ZONE_KEYS.map((k) => [k, false])),
    poiVisible: Object.fromEntries(Object.keys(POI_LAYERS).map((k) => [k, false])),
    zoningVisible: Object.fromEntries(ZONING_CATEGORIES.map((cat) => [cat.key, true])),
    vacantVisible: Object.fromEntries(Object.keys(VACANT_LABELS).map((k) => [k, false])),
    parcelsVisible: false,
    ownerFilter: "all" as const,
    expandedZone: null,
    zoningRefOpen: false,
    classRefOpen: false,
    inspectMode: false,
    activePreset: null,
    onClose: () => {},
    onToggleZone: () => {},
    onTogglePoi: () => {},
    onToggleZoningCategory: () => {},
    onToggleAllZoning: () => {},
    onSetVacantVisible: () => {},
    onSetParcelsVisible: () => {},
    onSetOwnerFilter: () => {},
    onSetExpandedZone: () => {},
    onSetZoningRefOpen: () => {},
    onSetClassRefOpen: () => {},
    onSetInspectMode: () => {},
    onApplyPreset: () => {},
    onSetOwnerClustersVisible: () => {},
  };
}

describe("MapLegendPanel admin ownership-cluster section", () => {
  it("does not claim that CCLBA inventory is globally loaded", () => {
    const html = renderToStaticMarkup(
      <MapLegendPanel
        {...baseProps()}
        adminSessionActive={false}
        ownerClustersVisible={false}
      />
    );

    expect(html).toContain("Source-attributed public vacancy records");
    expect(html).not.toContain("Cook County Land Bank Authority");
    expect(html).not.toContain("CCLBA inventory");
  });

  it("does not render the ADMIN section for a non-admin viewer", () => {
    const html = renderToStaticMarkup(
      <MapLegendPanel
        {...baseProps()}
        adminSessionActive={false}
        ownerClustersVisible={false}
      />
    );
    expect(html).not.toContain("Admin");
    expect(html).not.toContain("Ownership clusters");
  });

  it("renders the ADMIN section with the toggle defaulted off for an admin viewer", () => {
    const html = renderToStaticMarkup(
      <MapLegendPanel
        {...baseProps()}
        adminSessionActive={true}
        ownerClustersVisible={false}
      />
    );
    expect(html).toContain("Admin");
    expect(html).toContain("Ownership clusters");
    // Unchecked checkbox — no checked attribute in the static markup.
    expect(html).not.toMatch(/Ownership clusters[\s\S]*?checked="?true"?/);
  });

  it("reflects the toggle being on", () => {
    const html = renderToStaticMarkup(
      <MapLegendPanel
        {...baseProps()}
        adminSessionActive={true}
        ownerClustersVisible={true}
      />
    );
    expect(html).toContain("Ownership clusters");
  });

  it("shows a loading indicator and an error message when provided", () => {
    const loadingHtml = renderToStaticMarkup(
      <MapLegendPanel
        {...baseProps()}
        adminSessionActive={true}
        ownerClustersVisible={true}
        ownerClustersLoading={true}
      />
    );
    expect(loadingHtml).toContain("Loading ownership clusters");

    const errorHtml = renderToStaticMarkup(
      <MapLegendPanel
        {...baseProps()}
        adminSessionActive={true}
        ownerClustersVisible={true}
        ownerClustersError="Ownership clusters could not be loaded."
      />
    );
    expect(errorHtml).toContain("Ownership clusters could not be loaded.");
  });

  describe("color key", () => {
    it("renders nothing extra when the toggle is off, even with present types computed", () => {
      const html = renderToStaticMarkup(
        <MapLegendPanel
          {...baseProps()}
          adminSessionActive={true}
          ownerClustersVisible={false}
          ownerClustersPresentTypes={["corporate_llc", "local_private"]}
        />
      );
      expect(html).not.toContain(OWNER_TYPE_LABELS.corporate_llc);
      expect(html).not.toContain("Dot size");
    });

    it("renders nothing when the toggle is on but no data has loaded yet (empty present types)", () => {
      const html = renderToStaticMarkup(
        <MapLegendPanel
          {...baseProps()}
          adminSessionActive={true}
          ownerClustersVisible={true}
          ownerClustersPresentTypes={[]}
        />
      );
      expect(html).not.toContain(OWNER_TYPE_LABELS.corporate_llc);
      // The dot-size hint still shows once the layer is toggled on, independent of the key rows.
      expect(html).toContain("Dot size = vacant parcels in cluster");
    });

    it("renders one dot + label per owner type actually present, in canonical legend order", () => {
      const presentTypes = presentOwnerTypesInOrder(["local_private", "corporate_llc", "corporate_llc", "unknown"]);
      const html = renderToStaticMarkup(
        <MapLegendPanel
          {...baseProps()}
          adminSessionActive={true}
          ownerClustersVisible={true}
          ownerClustersPresentTypes={presentTypes}
        />
      );
      // Present, deduped, and in order: Corporate/LLC, Local Private, Unknown.
      expect(html).toContain(OWNER_TYPE_LABELS.corporate_llc);
      expect(html).toContain(OWNER_TYPE_LABELS.local_private);
      expect(html).toContain(OWNER_TYPE_LABELS.unknown);
      const corporateIdx = html.indexOf(OWNER_TYPE_LABELS.corporate_llc);
      const localIdx = html.indexOf(OWNER_TYPE_LABELS.local_private);
      const unknownIdx = html.indexOf(OWNER_TYPE_LABELS.unknown);
      expect(localIdx).toBeGreaterThan(corporateIdx);
      expect(unknownIdx).toBeGreaterThan(localIdx);
      // Absent types don't appear.
      expect(html).not.toContain(OWNER_TYPE_LABELS.out_of_state);
      expect(html).not.toContain(OWNER_TYPE_LABELS.city_public);
      expect(html).toContain("Dot size = vacant parcels in cluster");
    });
  });
});

/* ── WP4: zone layer groups in the legend ───────────────────── */

const ESCAPED = (label: string) => label.replace(/&/g, "&amp;");

/** The markup of the group button carrying `label`, up to the next button. */
function groupButton(html: string, label: string): string | undefined {
  return html.split("<button").find((chunk) => chunk.includes(ESCAPED(label)));
}

describe("MapLegendPanel zone layer groups", () => {
  const [grants, taxCredits, realEstate, pastAwards] = ZONE_LAYER_PRESETS;

  it("shows the three public groups and withholds the past-awards group from anonymous visitors", () => {
    const html = renderToStaticMarkup(
      <MapLegendPanel {...baseProps()} adminSessionActive={false} ownerClustersVisible={false} />
    );

    expect(html).toContain("Layer Groups");
    expect(html).toContain(ESCAPED(grants.label));
    expect(html).toContain(ESCAPED(taxCredits.label));
    expect(html).toContain(ESCAPED(realEstate.label));

    // Governance: capital layers are admin-only today, so the capital group
    // does not render for anonymous visitors and nothing about the gated
    // Community Investment layer leaks with it.
    expect(html).not.toContain(ESCAPED(pastAwards.label));
    expect(html).not.toContain("Community investment");
  });

  it("shows all four groups to an admin viewer without changing the capital gating", () => {
    const html = renderToStaticMarkup(
      <MapLegendPanel
        {...baseProps()}
        adminSessionActive={true}
        ownerClustersVisible={false}
        communityInvestmentVisible={false}
      />
    );

    for (const preset of ZONE_LAYER_PRESETS) {
      expect(html).toContain(ESCAPED(preset.label));
    }
    // The capital layer itself stays exactly as gated: present for admins,
    // still switched off until the admin turns it on.
    expect(html).toContain("Community investment");
    expect(html).not.toContain('aria-label="Investment view mode"');
  });

  it("marks no group active when the visible layers match none of them", () => {
    const html = renderToStaticMarkup(
      <MapLegendPanel {...baseProps()} adminSessionActive={false} ownerClustersVisible={false} />
    );
    expect(groupButton(html, grants.label)).toContain('aria-pressed="false"');
    expect(groupButton(html, taxCredits.label)).toContain('aria-pressed="false"');
  });

  it("marks exactly the group whose layers are visible as active", () => {
    const zoneVisible = { ...baseProps().zoneVisible };
    for (const key of grants.zones) zoneVisible[key] = true;

    const html = renderToStaticMarkup(
      <MapLegendPanel
        {...baseProps()}
        zoneVisible={zoneVisible}
        adminSessionActive={false}
        ownerClustersVisible={false}
      />
    );

    expect(groupButton(html, grants.label)).toContain('aria-pressed="true"');
    expect(groupButton(html, taxCredits.label)).toContain('aria-pressed="false"');
    expect(groupButton(html, realEstate.label)).toContain('aria-pressed="false"');
  });

  it("labels each group with the number of zone layers it carries", () => {
    const html = renderToStaticMarkup(
      <MapLegendPanel {...baseProps()} adminSessionActive={true} ownerClustersVisible={false} />
    );
    for (const preset of ZONE_LAYER_PRESETS) {
      expect(groupButton(html, preset.label)).toContain(`>${preset.zones.length}</span>`);
    }
  });
});
