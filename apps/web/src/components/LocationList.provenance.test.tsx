// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { LocationList, locationProvenance } from "./LocationList";
import type { Location } from "../api/client";

/**
 * `LocationResponse` carries seventeen fields. The web's `Location` interface
 * declared twelve, and four of the five it dropped were ones this very app had
 * written: `geocodedFrom` and `geocodeProvider` are recorded by
 * `handleGeocodePick` on every geocoded location, persisted, and returned on
 * every read — with no member on the type that reads them, so the only record of
 * why a pin is where it is was written and never read.
 *
 * These tests cover both halves: the wording (pure, so it can assert the exact
 * string) and the render (in the DOM, because the wiring into JSX is the part
 * nothing else in this app pins — three earlier defects here were restorable by
 * editing JSX alone with the whole suite green).
 */

const BASE: Location = {
  id: "l1",
  projectId: "p1",
  name: "Pawnee Creek",
  lng: -97.5,
  lat: 41.5,
  notes: null,
  label: "L1",
  referenceLabel: "see page L1",
  category: "Other",
  sourceConfidence: "Unknown",
  geocodedFrom: null,
  geocodeProvider: null,
  scalePresetId: null,
  pinShape: null,
  pinColor: null,
  zoomLevels: null,
};

const PRESETS = [{ id: "usgs-7-5-min", label: "1:24,000", ratio: 24000 }];

const noop = async () => {};

function renderList(loc: Location) {
  render(
    <LocationList
      locations={[loc]}
      scalePresets={PRESETS}
      projectScaleId="usgs-7-5-min"
      onAdd={noop}
      onDelete={noop}
      onSetScale={noop}
      onSetPin={noop}
      onSetZoomLevels={noop}
      onImport={async () => 0}
    />,
  );
}

describe("locationProvenance", () => {
  it("[BEHAVIORAL] names the query and the geocoder that answered it", () => {
    expect(
      locationProvenance({ geocodedFrom: "Pawnee Creek, NE", geocodeProvider: "nominatim" }),
    ).toBe("searched “Pawnee Creek, NE” · nominatim");
  });

  it("names the query alone when the server recorded no provider", () => {
    expect(locationProvenance({ geocodedFrom: "Pawnee Creek, NE", geocodeProvider: null }))
      .toBe("searched “Pawnee Creek, NE”");
  });

  it("[CONTROL] says nothing for a pin the user placed themselves", () => {
    // A coordinate someone clicked on the map, or imported from CSV, was not
    // "searched for". Captioning it as though it were would be the app answering
    // a question addressed to nobody — and this is the case that is by far the
    // most common, so getting it wrong would put a false caption on most rows.
    expect(locationProvenance({ geocodedFrom: null, geocodeProvider: null })).toBeNull();
    expect(locationProvenance({ geocodedFrom: "", geocodeProvider: "nominatim" })).toBeNull();
    expect(locationProvenance({ geocodedFrom: "   ", geocodeProvider: "nominatim" })).toBeNull();
  });
});

describe("LocationList renders the provenance it is given", () => {
  afterEach(cleanup);

  it("[BEHAVIORAL] shows where a geocoded location came from", () => {
    // The wiring, not the wording. Deleting the JSX block leaves every assertion
    // in the `locationProvenance` describe above green — which is exactly how
    // three earlier defects in this app survived.
    renderList({ ...BASE, geocodedFrom: "Pawnee Creek, NE", geocodeProvider: "nominatim" });
    expect(screen.getByText(/searched “Pawnee Creek, NE” · nominatim/)).toBeTruthy();
  });

  it("[CONTROL] shows no provenance line for a location that has none", () => {
    renderList(BASE);
    expect(screen.queryByText(/searched/)).toBeNull();
    // And the row is still a row: a control that renders nothing at all would
    // satisfy the assertion above.
    expect(screen.getByText("Pawnee Creek")).toBeTruthy();
  });
});
