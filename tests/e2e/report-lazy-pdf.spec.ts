import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { SAMPLE_REPORT_URL } from "../../lib/first-visit-guide";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

test("loads the PDF generator on demand and downloads a valid report", async ({
  page,
}) => {
  test.setTimeout(120000);

  await page.addInitScript(() => {
    window.localStorage.setItem(
      "cie:first-visit-guide",
      JSON.stringify({
        version: 1,
        status: "completed",
        updatedAt: "2026-08-30T00:00:00.000Z",
      }),
    );
    window.sessionStorage.removeItem("cie:first-visit-spotlight-pending");
  });

  await page.goto(`${baseURL}${SAMPLE_REPORT_URL}`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.locator("#verdict")).toBeVisible({ timeout: 45000 });

  const downloadAction = page
    .locator(".report-actions")
    .getByRole("button", { name: "Download PDF" })
    .first();
  await downloadAction.scrollIntoViewIfNeeded();
  await downloadAction.click();
  await expect(
    page.getByRole("heading", { name: "Download Report" }),
  ).toBeVisible();

  const downloadPromise = page.waitForEvent("download", { timeout: 60000 });
  await page.getByTestId("download-gate-skip").click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toMatch(
    /^chicago-incentive-report-.*\.pdf$/,
  );
  const downloadedPath = await download.path();
  expect(downloadedPath).not.toBeNull();
  const bytes = await readFile(downloadedPath!);
  expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
  expect(bytes.length).toBeGreaterThan(1_000);
  await expect(
    page.getByRole("heading", { name: "Download Report" }),
  ).toHaveCount(0);
});
