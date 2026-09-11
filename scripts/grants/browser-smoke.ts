/** Local-only browser test against the isolated grants database. Never use a production URL. */
import { chromium, expect } from "@playwright/test";
import { loadEnvConfig } from "@next/env";
import { encode } from "next-auth/jwt";
import { mkdir } from "node:fs/promises";
import { localTime } from "../../lib/grants/time";
loadEnvConfig(process.cwd());
const base = "http://localhost:3107";
async function main() {
  const browser = await chromium.launch({
    executablePath:
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
  });
  const secret = process.env.AUTH_SECRET,
    owner = process.env.GRANTS_OWNER_USER_ID;
  if (!secret || !owner)
    throw new Error("Local test auth configuration is required");
  const token = await encode({
    token: { sub: owner, name: "Workspace owner", email: "owner@example.test" },
    secret,
    maxAge: 3600,
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const errors: string[] = [];
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${base}/admin/grants`);
  await expect(
    page.getByRole("heading", { name: "A shared workspace for the team" }),
  ).toBeVisible();
  expect(
    (await context.request.get(`${base}/api/admin/grants/export`)).status(),
  ).toBe(403);
  await context.addCookies([
    {
      name: "next-auth.session-token",
      value: token,
      url: base,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Grants Matchmaker", exact: true }),
  ).toBeVisible();
  const suffix = Date.now().toString(),
    programName = `Browser check ${suffix}`;
  await page.getByRole("button", { name: "Add program", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name", { exact: true }).fill(programName);
  await dialog
    .getByLabel("Funder / sponsor", { exact: true })
    .fill("Test funder");
  await dialog
    .getByLabel("Program timing", { exact: true })
    .selectOption("hybrid");
  await dialog
    .getByLabel("Official program URL", { exact: true })
    .fill(`https://example.org/smoke-${suffix}`);
  await dialog.getByRole("button", { name: "Save to workspace" }).click();
  await expect(dialog).not.toBeVisible();
  await page
    .getByRole("button", { name: "Opportunities", exact: true })
    .click();
  await page.getByLabel("Search opportunities").fill(programName);
  await page.getByRole("button", { name: programName, exact: true }).click();
  await page.getByRole("button", { name: "Add round", exact: true }).click();
  await dialog.getByLabel("Name", { exact: true }).fill("Browser test round");
  await dialog
    .getByLabel("Published availability", { exact: true })
    .selectOption("open");
  const time = (offset: number) =>
    localTime(new Date(Date.now() + offset).toISOString(), "America/Chicago");
  await dialog
    .getByLabel("Deadline date and time", { exact: false })
    .fill(time(14 * 86400_000));
  await dialog
    .getByLabel("Verification status", { exact: true })
    .selectOption("verified");
  await dialog
    .getByLabel("Verified at", { exact: false })
    .fill(time(-3600_000));
  await dialog
    .getByLabel("Review again by", { exact: false })
    .fill(time(7 * 86400_000));
  await dialog
    .getByLabel("Evidence supporting dates, amounts and rules", {
      exact: false,
    })
    .fill("Synthetic browser fixture. Not a real award.");
  for (const [label, value] of [
    ["Roles: landlord, operator, tenant, any", "landlord"],
    ["Entities: for_profit, nonprofit, individual, any", "for_profit"],
    ["Stages: pre_opening, operating, any", "operating"],
    ["Business types (or any)", "LLC"],
    ["Industries (or any)", "Retail"],
    ["geography", "Chicago"],
    ["costs", "roofing"],
  ])
    await dialog.getByLabel(label, { exact: true }).fill(value);
  await dialog.getByRole("button", { name: "Save to workspace" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Browser test round open" }),
  ).toBeVisible();
  // A second authenticated browser sees the same persisted records.
  const second = await browser.newContext();
  await second.addCookies(await context.cookies());
  const shared = await second.request.get(`${base}/api/admin/grants/workspace`);
  const data = await shared.json();
  const program = data.programs.find(
    (p: { data: { name: string } }) => p.data.name === programName,
  );
  const round = data.rounds.find(
    (r: { data: { programId: string } }) => r.data.programId === program.id,
  );
  expect(round.data.review).toBe("verified");
  const csrf = await context.request.post(`${base}/api/admin/grants/programs`, {
    headers: { Origin: "https://foreign.example" },
    data: { id: program.id, version: program.version, data: program.data },
  });
  expect(csrf.status()).toBe(403);
  await page
    .getByRole("button", { name: "Businesses & matches", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Start questionnaire", exact: true })
    .first()
    .click();
  const businessName = `Questionnaire check ${suffix}`;
  await dialog.getByLabel("Business name", { exact: true }).fill(businessName);
  await dialog.getByLabel("Business type", { exact: true }).fill("LLC");
  await dialog.getByLabel("Business industry", { exact: true }).fill("Retail");
  await dialog.getByLabel("Intake date", { exact: true }).fill("2026-09-11");
  await dialog.getByLabel("Property owner / landlord", { exact: true }).check();
  await dialog.getByLabel("For-profit business", { exact: true }).check();
  await dialog.getByLabel("Already operating", { exact: true }).check();
  await mkdir("output/grants", { recursive: true });
  await page.screenshot({
    path: "output/grants/questionnaire-desktop.png",
    fullPage: true,
  });
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();
  await dialog
    .getByLabel("Primary goal", { exact: true })
    .fill("Repair the building roof");
  await dialog.getByLabel("Roofing", { exact: true }).check();
  await dialog
    .getByLabel("Confirmed locations / zones", { exact: true })
    .fill("Chicago");
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();
  for (const label of ["Reimbursement", "Tax benefit", "In-kind support"])
    await dialog.getByLabel(label, { exact: true }).uncheck();
  await dialog
    .getByLabel("Target funding date", { exact: true })
    .fill("2026-11-01");
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();
  await dialog
    .getByLabel("Source / confirmation note", { exact: true })
    .fill("Synthetic browser intake, not a real client.");
  await expect(
    dialog.getByText("Repair the building roof", { exact: true }),
  ).toBeVisible();
  // A refresh failure after a successful write must not invite a duplicate intake.
  await page.route(
    "**/api/admin/grants/workspace",
    (route) =>
      route.fulfill({
        status: 503,
        json: { error: "Synthetic refresh failure" },
      }),
    { times: 1 },
  );
  await dialog
    .getByRole("button", { name: "Save & generate shortlist", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("alert").filter({ hasText: "Profile saved successfully" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: businessName, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByTestId("shortlist-result").filter({
      has: page.getByRole("heading", { name: programName, exact: true }),
    }),
  ).toBeVisible();
  expect(
    await page.getByTestId("shortlist-result").count(),
  ).toBeLessThanOrEqual(5);
  await page.screenshot({
    path: "output/grants/shortlist-desktop.png",
    fullPage: true,
  });
  const savedData = await (
    await second.request.get(`${base}/api/admin/grants/workspace`)
  ).json();
  let applicant = savedData.applicants.find(
    (a: { data: { name: string } }) => a.data.name === businessName,
  );
  expect(applicant.data).toMatchObject({
    businessType: "LLC",
    industry: "Retail",
    primaryGoal: "Repair the building roof",
    intakeDate: "2026-09-11",
    targetDate: "2026-11-01",
    costs: ["roofing"],
    geography: ["Chicago"],
    fundingTypes: ["grant"],
  });
  // Changing a questionnaire answer must change the recommendations, not just the profile card.
  await page
    .getByRole("button", { name: "Update answers", exact: true })
    .click();
  await dialog.getByLabel("Business operator", { exact: true }).check();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "output/grants/questionnaire-mobile.png",
    fullPage: true,
  });
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  for (let i = 0; i < 3; i++)
    await dialog.getByRole("button", { name: "Continue", exact: true }).click();
  await dialog
    .getByRole("button", { name: "Save & generate shortlist", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByTestId("shortlist-result").filter({
      has: page.getByRole("heading", { name: programName, exact: true }),
    }),
  ).toHaveCount(0);
  const edited = await (
    await second.request.get(`${base}/api/admin/grants/workspace`)
  ).json();
  applicant = edited.applicants.find(
    (a: { id: string }) => a.id === applicant.id,
  );
  expect(applicant.data.role).toBe("operator");
  expect(applicant.version).toBe(2);
  // Archive synthetic records after exercising real routes; no client data is touched.
  for (const [resource, record] of [
    ["rounds", round],
    ["programs", program],
    ["applicants", applicant],
  ] as const) {
    const archived = {
      ...record.data,
      ...(resource === "rounds" ? { review: "archived" } : { archived: true }),
    };
    const res = await context.request.post(
      `${base}/api/admin/grants/${resource}`,
      {
        headers: { Origin: base },
        data: { id: record.id, version: record.version, data: archived },
      },
    );
    expect(res.ok()).toBe(true);
  }
  await page.reload();
  await page
    .getByRole("button", { name: "Opportunities", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: programName, exact: true }),
  ).toHaveCount(0);
  await mkdir("output/grants", { recursive: true });
  await page.screenshot({
    path: "output/grants/opportunities-desktop.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Businesses & matches", exact: true })
    .click();
  await page.getByLabel("Choose business").selectOption("pilot-ken");
  await expect(
    page.getByRole("heading", { name: "Kenneth Vanderbilt" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sources", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Scan due sources", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Team & history", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Team access" }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Grants Matchmaker", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "output/grants/overview-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: "output/grants/overview-desktop.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
  console.log(
    "PASS: gate, staff UI, program/round creation, timezone inputs, second-session persistence, CSRF, questionnaire required fields and saved answers, role-sensitive shortlist, archival, pilot profile, sources, team view, mobile overflow and browser errors.",
  );
  await browser.close();
}
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
