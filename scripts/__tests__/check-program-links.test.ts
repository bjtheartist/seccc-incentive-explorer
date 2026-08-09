import { describe, expect, it } from "vitest";
import { classify } from "../check-submittable-links.mjs";

/**
 * The link checker's verdict has THREE states, and the third one is the point.
 *
 * Several agency hosts (congress.gov, eda.gov) answer automated clients with
 * 403 while serving the page normally to a browser. Folding those into "broken"
 * would report an absence of evidence as evidence of a dead link — the exact
 * error the zoning provenance work removed, reappearing in a different file.
 * `blocked` says we did not find out, and the CI gate deliberately does not
 * fail on it.
 */
describe("link-health classify", () => {
  it("scores a reachable page ok", () => {
    expect(classify({ ok: true, status: 200 })).toBe("ok");
    expect(classify({ ok: true, status: 204 })).toBe("ok");
  });

  it("scores a genuinely missing page broken", () => {
    expect(classify({ ok: false, status: 404 })).toBe("broken");
    expect(classify({ ok: false, status: 410 })).toBe("broken");
    expect(classify({ ok: false, status: 500 })).toBe("broken");
  });

  it("does NOT score a bot filter as a dead link", () => {
    // The four codes agency WAFs actually return to a scripted client.
    for (const status of [401, 403, 405, 406, 429]) {
      expect(classify({ ok: false, status }), `HTTP ${status}`).toBe("blocked");
    }
  });

  it("treats a transport failure as broken, not blocked", () => {
    // status 0 == DNS failure, TLS failure, or timeout. Nothing answered at
    // all, so there is no bot filter to credit — that is a real defect.
    expect(classify({ ok: false, status: 0 })).toBe("broken");
  });
});
