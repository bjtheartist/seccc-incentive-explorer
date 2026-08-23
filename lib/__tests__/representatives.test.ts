import { describe, expect, it } from "vitest";
import {
  buildOfficialsForDistricts,
  formatChicagoAldermanName,
  parseCookCountyCommissioners,
  parseHouseMembers,
  parseIlgaMembers,
} from "@/lib/representatives";

describe("representatives", () => {
  it("formats Chicago alderman names from the ward office feed", () => {
    expect(formatChicagoAldermanName("La Spata, Daniel")).toBe("Daniel La Spata");
    expect(formatChicagoAldermanName("Coleman, Stephanie D.")).toBe("Stephanie D. Coleman");
  });

  it("parses Illinois members from House Clerk XML", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <MemberData publish-date="July 6, 2026">
        <members>
          <member>
            <statedistrict>IL01</statedistrict>
            <member-info>
              <namelist>Jackson, Jonathan</namelist>
              <bioguideID>J000309</bioguideID>
              <official-name>Jonathan L. Jackson</official-name>
              <party>D</party>
              <phone>(202) 225-0773</phone>
            </member-info>
          </member>
        </members>
      </MemberData>`;

    const roster = parseHouseMembers(xml);
    expect(roster["1"]).toMatchObject({
      district: "1",
      name: "Jonathan L. Jackson",
      party: "D",
      phone: "(202) 225-0773",
      sourcePublishedAt: "July 6, 2026",
    });
  });

  it("parses ILGA member cards once per district", () => {
    const html = `
      <h2 class="h5 card-title"><a class="notranslate" href="/House/Members/Details/3441">Kimberly Du Buclet</a> (D)</h2>
      <p class="card-text">
        Representative
        <br />5th District
      </p>
      <h2 class="h5 card-title"><a class="notranslate" href="/House/Members/Details/3441">Kimberly Du Buclet</a> (D)</h2>
      <p class="card-text">
        Representative
        <br />5th District
      </p>`;

    const roster = parseIlgaMembers(html, "House");
    expect(Object.keys(roster)).toEqual(["5"]);
    expect(roster["5"]).toMatchObject({
      district: "5",
      name: "Kimberly Du Buclet",
      party: "D",
      url: "https://www.ilga.gov/House/Members/Details/3441",
    });
  });

  it("parses Cook County commissioner cards from the official directory", () => {
    const html = `
      <div class="profile-name">
        <a href="https://www.cookcountyil.gov/all-people/stanley-moore" aria-label="view profile of Stanley Moore">Stanley Moore</a>
      </div>
      <div class="profile-info">
        <div class="profile-agency"><a href="/board-of-commissioners">Board of Commissioners</a></div><br><br>
        <div class="profile-job-title">COUNTY BOARD COMMISSIONER, 4TH DISTRICT</div>
      </div>`;

    const roster = parseCookCountyCommissioners(html);
    expect(roster["4"]).toMatchObject({
      district: "4",
      name: "Stanley Moore",
      url: "https://www.cookcountyil.gov/all-people/stanley-moore",
    });
  });

  it("builds current officials for a district lookup", () => {
    const officials = buildOfficialsForDistricts(
      {
        ward: "10",
        congressionalDistrict: "2",
        stateHouseDistrict: "25",
        stateSenateDistrict: "13",
        commissionerDistrict: "4",
        policeDistrict: "4",
      },
      {
        wardOffices: {
          "10": { ward: "10", alderman: "Chico, John A.", email: "ward10@cityofchicago.org" },
        },
        commissioners: {
          "4": { district: "4", name: "Stanley Moore", url: "https://www.cookcountyil.gov/all-people/stanley-moore" },
        },
        house: {
          "2": { district: "2", name: "Robin L. Kelly", party: "D", bioguideId: "K000385" },
        },
        ilgaHouse: {
          "25": { district: "25", name: "Curtis J. Tarver II", party: "D", url: "https://www.ilga.gov/House/Members/Details/3294" },
        },
        ilgaSenate: {
          "13": { district: "13", name: "Robert Peters", party: "D", url: "https://www.ilga.gov/Senate/Members/Details/3375" },
        },
      },
      "2026-07-09T12:00:00.000Z",
    );

    expect(officials.alderperson?.name).toBe("John A. Chico");
    expect(officials.commissioner?.name).toBe("Stanley Moore");
    expect(officials.congressionalRepresentative?.districtLabel).toBe("IL-2");
    expect(officials.stateRepresentative?.name).toBe("Curtis J. Tarver II");
    expect(officials.stateSenator?.name).toBe("Robert Peters");
  });
});
