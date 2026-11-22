// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { WorksheetLegsEditor } from "./WorksheetLegsEditor";

afterEach(cleanup);

const ENDS = [
  { ref: "L1", label: "L1 Capitol" },
  { ref: "L2", label: "L2 Haymarket" },
  { ref: "Water Tower", label: "Water Tower (landmark)" },
];

describe("WorksheetLegsEditor", () => {
  it("[BEHAVIORAL] adds the chosen start and finish as a leg", () => {
    const onChange = vi.fn();
    render(<WorksheetLegsEditor ends={ENDS} value={[]} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Leg start"), { target: { value: "L2" } });
    fireEvent.change(screen.getByLabelText("Leg finish"), { target: { value: "Water Tower" } });
    fireEvent.click(screen.getByRole("button", { name: "Add leg" }));
    expect(onChange).toHaveBeenCalledWith([{ from: "L2", to: "Water Tower" }]);
  });

  it("will not add a leg from a place to itself", () => {
    render(<WorksheetLegsEditor ends={ENDS} value={[]} onChange={() => {}} />);
    fireEvent.change(screen.getByLabelText("Leg finish"), { target: { value: "L1" } });
    expect((screen.getByRole("button", { name: "Add leg" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("lists the legs with readable names and removes one", () => {
    const onChange = vi.fn();
    render(<WorksheetLegsEditor ends={ENDS} value={[{ from: "L1", to: "L2" }, { from: "L2", to: "Water Tower" }]} onChange={onChange} />);
    expect(screen.getByText(/L2 Haymarket to Water Tower \(landmark\)/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove leg 1" }));
    expect(onChange).toHaveBeenCalledWith([{ from: "L2", to: "Water Tower" }]);
  });

  it("[BEHAVIORAL] moves its picks back onto ends that exist when the ends change", () => {
    const onChange = vi.fn();
    const { rerender } = render(<WorksheetLegsEditor ends={ENDS} value={[]} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Leg start"), { target: { value: "Water Tower" } });
    // The landmark is no longer offered (deleted, or landmarks turned off).
    rerender(<WorksheetLegsEditor ends={ENDS.slice(0, 2)} value={[]} onChange={onChange} />);
    expect((screen.getByLabelText("Leg start") as HTMLSelectElement).value).toBe("L1");
    fireEvent.click(screen.getByRole("button", { name: "Add leg" }));
    expect(onChange).toHaveBeenLastCalledWith([{ from: "L1", to: "L2" }]);
  });
});
