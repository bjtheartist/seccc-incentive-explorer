// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import ShortlistReviewGroup from "../ShortlistReviewGroup";
afterEach(cleanup);
it("opens dated reasons and parcel verification links on demand, keeping uncertain records separate", () => {
 render(<ShortlistReviewGroup title="Needs verification" total={30} records={[{key:"a",address:"8408 S BURLEY AVE",pin:"21322040270000",identityStatus:"saved",recordedType:"multifamily",sourceYear:"2024",zoningDistrict:"RS-3",reasons:["Land and building records conflict; verify current property type."]}]} />);
 expect(screen.queryByText("8408 S BURLEY AVE")).toBeNull();
 fireEvent.click(screen.getByRole("button",{name:"Show needs verification records"}));
 expect(screen.getByText("8408 S BURLEY AVE")).toBeTruthy();
 expect(screen.getByText(/Land and building records conflict/)).toBeTruthy();
 expect(screen.getByRole("link",{name:"Verify parcel in CookViewer"}).getAttribute("href")).toContain("21322040270000");
 fireEvent.click(screen.getByRole("button",{name:"Hide needs verification records"}));
 expect(screen.queryByText("8408 S BURLEY AVE")).toBeNull();
});
