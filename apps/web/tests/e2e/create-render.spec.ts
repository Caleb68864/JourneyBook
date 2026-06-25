/**
 * Smoke test: create project → bbox → scale usgs-7-5-min + tier 1 → location → Generate
 *
 * API calls are intercepted and mocked so the test does not require a running backend.
 * To run against the real stack, remove the page.route() calls and ensure
 * `pnpm dev:web` and `dotnet run --project apps/api` are both running first.
 *
 * Run: pnpm --filter @journeybook/web test:e2e
 */

import { test, expect, type Page } from "@playwright/test";

const PROJECT_ID = "proj-e2e-001";

// Shapes mirror the C# API contract (the web client adapts extent object→tuple):
const MOCK_PROJECT = {
  id: PROJECT_ID,
  name: "E2E Smoke Test Atlas",
  scalePresetId: "usgs-7-5-min",
  orientation: "Portrait",
  overlap: 0,
  extent: null,
  createdAt: "2026-06-24T00:00:00.000Z",
  updatedAt: "2026-06-24T00:00:00.000Z",
};

const MOCK_PROJECT_WITH_EXTENT = {
  ...MOCK_PROJECT,
  extent: { west: -96.5, south: 41.0, east: -96.0, north: 41.5 },
};

const MOCK_LOCATION = {
  id: "loc-001",
  projectId: PROJECT_ID,
  name: "Trailhead",
  lng: -96.25,
  lat: 41.25,
  notes: null,
  label: "L1",
  referenceLabel: "see page L1",
};

const MOCK_RENDER = {
  generatedPdfId: "job-001",
  downloadUrl: "/api/generated-pdfs/job-001/content",
  status: "Completed",
};

async function setupApiMocks(page: Page) {
  await page.route("**/api/projects", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: [] });
    } else if (route.request().method() === "POST") {
      await route.fulfill({ json: MOCK_PROJECT });
    } else {
      await route.continue();
    }
  });

  await page.route(`**/api/projects/${PROJECT_ID}`, async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: MOCK_PROJECT });
    } else {
      await route.continue();
    }
  });

  await page.route(`**/api/projects/${PROJECT_ID}/extent`, async (route) => {
    await route.fulfill({ json: MOCK_PROJECT_WITH_EXTENT });
  });

  await page.route(`**/api/projects/${PROJECT_ID}/locations`, async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: [] });
    } else if (route.request().method() === "POST") {
      await route.fulfill({ json: MOCK_LOCATION });
    } else {
      await route.continue();
    }
  });

  await page.route(`**/api/projects/${PROJECT_ID}/locations/**`, async (route) => {
    await route.fulfill({ status: 204, body: "" });
  });

  await page.route(`**/api/projects/${PROJECT_ID}/render`, async (route) => {
    await route.fulfill({ json: MOCK_RENDER });
  });

  await page.route("**/api/generated-pdfs/**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/pdf", body: "" });
  });

  // Suppress MapLibre tile requests
  await page.route("**/api/tiles/**", async (route) => {
    await route.fulfill({ status: 204, body: "" });
  });
}

test("create project → bbox → scale + tier → location → generate", async ({ page }) => {
  await setupApiMocks(page);

  // 1. Open app
  await page.goto("/");
  await expect(page.getByText("Journey Book")).toBeVisible();

  // 2. Create a new project
  await page.getByRole("button", { name: /New Atlas/i }).click();
  await page.getByPlaceholder(/Summer Camp/i).fill("E2E Smoke Test Atlas");
  await page.getByRole("button", { name: /^Create$/i }).click();

  // 3. Expect navigation to the project editor
  await expect(page.getByText("← Projects")).toBeVisible();
  await expect(page.getByText("E2E Smoke Test Atlas")).toBeVisible();

  // 4. Enter bounding box via manual inputs
  await page.getByLabel(/^west$/i).fill("-96.5");
  await page.getByLabel(/^south$/i).fill("41.0");
  await page.getByLabel(/^east$/i).fill("-96.0");
  await page.getByLabel(/^north$/i).fill("41.5");

  const [extentRequest] = await Promise.all([
    page.waitForRequest(
      (req) =>
        req.url().includes(`/api/projects/${PROJECT_ID}/extent`) && req.method() === "PUT",
    ),
    page.getByRole("button", { name: /^Apply$/i }).click(),
  ]);
  expect(extentRequest).toBeTruthy();

  // 5. Verify scale picker shows usgs-7-5-min (default at creation)
  const scaleSelect = page.locator("select").nth(0);
  await expect(scaleSelect).toHaveValue("usgs-7-5-min");

  // 6. Verify tier picker shows tier 1 (default at creation)
  const tierSelect = page.locator("select").nth(1);
  await expect(tierSelect).toHaveValue("1");

  // 7. Add a location via coordinate form
  await page.getByPlaceholder(/Grandma/i).fill("Trailhead");
  await page.getByPlaceholder(/Longitude/i).fill("-96.25");
  await page.getByPlaceholder(/Latitude/i).fill("41.25");

  const [locationRequest] = await Promise.all([
    page.waitForRequest(
      (req) =>
        req.url().includes(`/api/projects/${PROJECT_ID}/locations`) && req.method() === "POST",
    ),
    page.getByRole("button", { name: /^Add Location$/i }).click(),
  ]);
  expect(locationRequest).toBeTruthy();
  await expect(page.getByText("Trailhead")).toBeVisible();

  // 8. Click Generate and verify render request is issued
  const [renderRequest] = await Promise.all([
    page.waitForRequest(
      (req) =>
        req.url().includes(`/api/projects/${PROJECT_ID}/render`) && req.method() === "POST",
    ),
    page.getByRole("button", { name: /Generate Atlas PDF/i }).click(),
  ]);
  expect(renderRequest).toBeTruthy();

  // 9. Verify success state
  await expect(page.getByText(/PDF opened in a new tab/i)).toBeVisible({ timeout: 8000 });
});
