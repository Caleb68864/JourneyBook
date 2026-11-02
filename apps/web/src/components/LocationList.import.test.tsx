// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { LocationList } from "./LocationList";

/** The DOM half: the picker offers JSON, and what reaches `onImport` is always CSV. */

function renderList(onImport: (csv: string) => Promise<number>) {
  const noop = async () => {};
  render(
    <LocationList
      locations={[]}
      scalePresets={[{ id: "usgs-7-5-min", label: "1:24,000", ratio: 24000 }]}
      projectScaleId="usgs-7-5-min"
      onAdd={noop}
      onDelete={noop}
      onSetScale={noop}
      onSetPin={noop}
      onSetZoomLevels={noop}
      onImport={onImport}
    />,
  );
  return screen.getByLabelText(/import csv or backup/i) as HTMLInputElement;
}

function pick(input: HTMLInputElement, text: string) {
  const file = new File([text], "stops.journeybook.json");
  // jsdom's File has no text().
  Object.defineProperty(file, "text", { value: async () => text });
  fireEvent.change(input, { target: { files: [file] } });
}

describe("LocationList import", () => {
  afterEach(cleanup);

  it("offers JSON files as well as CSV", () => {
    expect(renderList(async () => 0).accept).toMatch(/\.json/);
  });

  it("[BEHAVIORAL] sends a project backup to the importer as CSV", async () => {
    const onImport = vi.fn(async () => 1);
    pick(renderList(onImport), JSON.stringify({ project: {}, locations: [{ name: "Camp", lng: -97, lat: 41 }] }));

    await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1));
    expect(onImport).toHaveBeenCalledWith("name,lng,lat,notes,scale,pin,color,zoom\nCamp,-97,41,,,,,\n");
    await screen.findByText("Imported 1 location.");
  });

  it("shows why a bad backup was refused and imports nothing", async () => {
    const onImport = vi.fn(async () => 0);
    pick(renderList(onImport), '{"project":{}}');

    await screen.findByText(/array of locations/);
    expect(onImport).not.toHaveBeenCalled();
  });
});
