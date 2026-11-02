// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { TitlePageFields } from "./TitlePageFields";

describe("TitlePageFields", () => {
  afterEach(cleanup);

  it("[BEHAVIORAL] saves on blur, trimmed, keeping the other field", () => {
    const onChange = vi.fn();
    render(<TitlePageFields value={{ explorerName: null, atlasDate: "Summer 2026" }} onChange={onChange} />);
    const name = screen.getByLabelText("Explorer name");

    fireEvent.change(name, { target: { value: "  Ada " } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.blur(name);

    expect(onChange).toHaveBeenCalledWith({ explorerName: "Ada", atlasDate: "Summer 2026" });
  });

  it("clears to null, so a blank field prints nothing", () => {
    const onChange = vi.fn();
    render(<TitlePageFields value={{ explorerName: "Ada", atlasDate: null }} onChange={onChange} />);
    const name = screen.getByLabelText("Explorer name");

    fireEvent.change(name, { target: { value: "   " } });
    fireEvent.blur(name);

    expect(onChange).toHaveBeenCalledWith({ explorerName: null, atlasDate: null });
  });

  it("[CONTROL] does not save when nothing changed", () => {
    const onChange = vi.fn();
    render(<TitlePageFields value={{ explorerName: "Ada", atlasDate: null }} onChange={onChange} />);
    fireEvent.blur(screen.getByLabelText("Explorer name"));
    fireEvent.blur(screen.getByLabelText("Date"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("shows the saved value again when the project changes underneath it", () => {
    const onChange = vi.fn();
    const { rerender } = render(<TitlePageFields value={{ explorerName: "Ada", atlasDate: null }} onChange={onChange} />);
    rerender(<TitlePageFields value={{ explorerName: "Grace", atlasDate: null }} onChange={onChange} />);
    expect((screen.getByLabelText("Explorer name") as HTMLInputElement).value).toBe("Grace");
  });
});
