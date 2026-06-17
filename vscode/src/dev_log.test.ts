import { format_error_detail, should_enable_dev_log } from "./dev_log";

describe("should_enable_dev_log", () => {
  it("returns false in a packaged install with devMode off (AC#2 regression guard)", () => {
    expect(should_enable_dev_log(false, false)).toBe(false);
  });

  it("returns true when devMode is on regardless of extension context", () => {
    expect(should_enable_dev_log(true, false)).toBe(true);
  });

  it("returns true in a development extension context with devMode off", () => {
    expect(should_enable_dev_log(false, true)).toBe(true);
  });

  it("returns true when both devMode and development context are on", () => {
    expect(should_enable_dev_log(true, true)).toBe(true);
  });
});

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
