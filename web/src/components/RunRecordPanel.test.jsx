import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen, waitFor, fireEvent } from "@testing-library/react";
import RunRecordPanel, { stateOf } from "./RunRecordPanel.jsx";

const getJson = vi.fn();
vi.mock("../api", () => ({ getJson: (...a) => getJson(...a) }));

const RID = "run-mppy1i4g-3adaaa5c";
const OTHER = "run-mppy1i4h-1bbbbbb2";
const okRun = (runId) => ({ ok: true, status: 200, body: { ok: true, run: {}, observability: { runId } } });
const recordFor = (runId) => ({
  runId, source: "mock", window: { from: "2026-11-25T10:00:00.000Z", to: "2026-11-25T10:00:00.000Z" }, excerpt: true, truncated: false,
  coverage: { person: "not-logged", agent: "simulated", authorize: "simulated", privilege: "not-logged", gateway: "simulated", resource: "not-logged" },
  reasons: { person: "This run had no sign-in, consent or hold step." },
  rows: [{ id: "r1", at: "2026-11-25T10:00:00.000Z", layer: "authorize", product: "lab engine", outcome: "allowed", message: "1. Authorize decision", origin: "simulated" }],
  partial: false, summary: { allowed: 1, refused: 0, blocked: 0, info: 0, unverified: 0 }, chain: [],
});

beforeEach(() => { getJson.mockReset(); });
afterEach(() => { cleanup(); });

describe("RunRecordPanel", () => {
  test("nothing is shown before a run, and a run without a record says so instead of showing an empty record", () => {
    const { container, rerender } = render(<RunRecordPanel result={null} />);
    expect(container.innerHTML).toBe("");
    rerender(<RunRecordPanel result={{ ok: true, status: 200, body: { ok: true, run: {} } }} />);
    expect(screen.getByTestId("run-record-none").textContent).toMatch(/this run's record is not built/);
    expect(getJson).not.toHaveBeenCalled();
  });

  test("a failed run has no record and reads none", () => {
    const { container } = render(<RunRecordPanel result={{ ok: false, status: 403, body: { error: "mock_signin_refused" } }} />);
    expect(container.innerHTML).toBe("");
    expect(getJson).not.toHaveBeenCalled();
  });

  test("the record is read once for its run id and shown through the vendored panel as Mock", async () => {
    getJson.mockResolvedValue(recordFor(RID));
    render(<RunRecordPanel result={okRun(RID)} />);
    expect(screen.getByTestId("run-record-loading").textContent).toMatch(/Collecting/);
    await waitFor(() => expect(screen.getByTestId("run-record")).toBeTruthy());
    expect(getJson).toHaveBeenCalledWith(`/api/run-observability/${RID}`);
    expect(screen.getByTestId("ro-basis").textContent).toMatch(/Simulated/);
  });

  test("a previous record is never shown while the next one loads", async () => {
    let resolveSecond;
    getJson.mockImplementation((url) => (url.endsWith(RID) ? Promise.resolve(recordFor(RID)) : new Promise((r) => { resolveSecond = r; })));
    const { rerender } = render(<RunRecordPanel result={okRun(RID)} />);
    await waitFor(() => expect(screen.getByTestId("run-record")).toBeTruthy());
    rerender(<RunRecordPanel result={okRun(OTHER)} />);
    expect(screen.queryByTestId("run-record")).toBeNull();
    expect(screen.getByTestId("run-record-loading")).toBeTruthy();
    resolveSecond(recordFor(OTHER));
    await waitFor(() => expect(screen.getByTestId("run-record")).toBeTruthy());
  });

  test.each([
    ["null", null],
    ["an empty array", []],
    ["a JSON string", "ok"],
    ["an empty object", {}],
    ["a record for another run", recordFor(OTHER)],
  ])("a 200 answer that is %s is an alert, never the empty state", async (_name, answer) => {
    getJson.mockResolvedValue(answer);
    render(<RunRecordPanel result={okRun(RID)} />);
    await waitFor(() => expect(screen.getByTestId("run-record-alert")).toBeTruthy());
    expect(screen.queryByTestId("ro-empty")).toBeNull();
  });

  test("a non-JSON 200 body (getJson throws) is an alert too", async () => {
    getJson.mockRejectedValue(new SyntaxError("Unexpected token <"));
    render(<RunRecordPanel result={okRun(RID)} />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
  });

  test("a 404 says the record is not held in this mode, and an error is an alert with a retry that reads again", async () => {
    getJson.mockRejectedValueOnce(Object.assign(new Error("HTTP 404"), { status: 404, body: {} }));
    const { unmount } = render(<RunRecordPanel result={okRun(RID)} />);
    await waitFor(() => expect(screen.getByTestId("run-record-gone")).toBeTruthy());
    unmount();
    getJson.mockRejectedValueOnce(Object.assign(new Error("HTTP 500"), { status: 500, body: {} }));
    getJson.mockResolvedValueOnce(recordFor(RID));
    render(<RunRecordPanel result={okRun(RID)} />);
    await waitFor(() => expect(screen.getByTestId("run-record-alert")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByTestId("run-record")).toBeTruthy());
    expect(getJson).toHaveBeenCalledTimes(3);
  });
});

describe("stateOf", () => {
  test("never throws on any answer", () => {
    for (const body of [null, undefined, [], "x", 0, {}, { runId: RID }]) expect(() => stateOf(RID, { status: "answer", body })).not.toThrow();
    expect(stateOf(RID, { status: "answer", body: recordFor(RID) }).status).toBe("ready");
    expect(stateOf(RID, { status: "answer", body: null }).status).toBe("alert");
    expect(stateOf(RID, { status: "error", code: 404 }).status).toBe("none");
    expect(stateOf(RID, { status: "error", code: 500 }).status).toBe("alert");
  });
});
