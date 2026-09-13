import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("not found"); }, redirect: (href: string) => { throw new Error("redirect:" + href); } }));
import Page from "../page";
const props = (search: Record<string,string>) => ({ params: Promise.resolve({zip:"60617"}), searchParams: Promise.resolve(search) });
describe("refined criteria cannot silently fall back to the broad property map", () => {
 it("redirects a complete refined brief to the matching shortlist map", async () => {
   await expect(Page(props({sm_v:"2",sm_use:"retail-service",sm_property:"existing-building",sm_building_types:"commercial"}))).rejects.toThrow(/redirect:.*shortlist.*sm_building_types=commercial.*#shortlist-map/);
 });
 it("renders a criteria review instead of dropping an unsupported building type", async () => {
   expect(renderToStaticMarkup(await Page(props({sm_v:"2",sm_building_types:"castle"})))).toContain("These search criteria need review");
 });
 it("renders a completion prompt for an incomplete refined brief", async () => {
   expect(renderToStaticMarkup(await Page(props({sm_v:"2",sm_use:"retail-service"})))).toContain("Complete your search criteria");
 });
});
