import { format_error_detail } from "./dev_log";

describe("format_error_detail", () => {
  it("includes the stack trace for an Error", () => {
    const error = new Error("boom");
    const detail = format_error_detail(error);
    expect(detail).toContain("boom");
    // The native stack begins with the message and continues with frames.
    expect(detail).toContain("at ");
    expect(detail).toBe(error.stack);
  });

  it("falls back to name + message when stack is absent", () => {
    const error = new Error("no stack");
    error.stack = undefined;
    expect(format_error_detail(error)).toBe("Error: no stack");
  });

  it("unwinds a nested cause chain", () => {
    const root = new Error("fk constraint violation");
    const wrapper = new Error("workflow failed", { cause: root });
    const detail = format_error_detail(wrapper);
    expect(detail).toContain("workflow failed");
    expect(detail).toContain("Caused by:");
    expect(detail).toContain("fk constraint violation");
  });

  it("handles a non-Error cause", () => {
    const wrapper = new Error("outer", { cause: "raw string cause" });
    expect(format_error_detail(wrapper)).toContain("Caused by: raw string cause");
  });

  it("stringifies non-Error throws", () => {
    expect(format_error_detail("just a string")).toBe("just a string");
    expect(format_error_detail(42)).toBe("42");
  });
});
