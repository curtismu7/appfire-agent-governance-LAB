// The Sign in dialog's two extra steps (owner 2026-11-17): "Forgot password?" (code by email, then the code and a new password) and "Choose a new
// password" (PingOne holds the sign-in for a temporary or expired password). The dialog only talks to this lab's own server; every secret is cleared once sent.
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SignInDialog from "./components/SignInDialog";
import { forgetWorkspace } from "./workspace";

const CODE = "ABCD1234";
const NEW_PW = ["Brand", "New-", "Pass-", "77"].join("");
const OLD_PW = ["Temp", "orary-", "Pass-", "11"].join("");
let calls;
// answers: path -> a function (body) -> { status, body }
const stub = (answers) => {
  calls = [];
  answers = { "/api/signin/options": () => ({ status: 200, body: { recovery: true } }), ...answers }; // PingOne offers recovery unless a test says otherwise
  vi.stubGlobal("fetch", async (url, init = {}) => {
    const path = String(url);
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ path, method: init.method || "GET", body });
    const a = answers[path];
    if (!a) return new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers: { "content-type": "application/json" } });
    const { status, body: out } = a(body);
    return new Response(JSON.stringify(out), { status, headers: { "content-type": "application/json" } });
  });
};
const open = async (props = {}) => {
  const onClose = vi.fn(); const onSignedIn = vi.fn();
  render(<SignInDialog isOpen username="demo-user" onClose={onClose} onSignedIn={onSignedIn} {...props} />);
  const dlg = await screen.findByTestId("signin-dialog");
  return { dlg, onClose, onSignedIn, u: userEvent.setup() };
};
const posts = (path) => calls.filter((c) => c.path === path && c.method === "POST");
afterEach(() => { cleanup(); vi.unstubAllGlobals(); forgetWorkspace(); try { window.localStorage.clear(); } catch { /* ignore */ } });

describe("Forgot password?", () => {
  test("the link asks the lab's server to start a recovery (no username typed), then the dialog asks for the emailed code and a new password", async () => {
    stub({ "/api/signin/forgot": () => ({ status: 200, body: { signedIn: false, next: "recovery_code", message: "PingOne found the user. Enter the recovery code." } }) });
    const { dlg, u } = await open();
    expect((await within(dlg).findByTestId("signin-forgot")).textContent).toMatch(/Forgot password\?/);
    await u.click(await within(dlg).findByTestId("signin-forgot"));
    await within(dlg).findByTestId("signin-recover-form");
    expect(posts("/api/signin/forgot")).toHaveLength(1); expect(posts("/api/signin/forgot")[0].body).toEqual({});
    expect(within(dlg).getByTestId("fd-titlebar").textContent).toMatch(/Forgot password/);
    expect(within(dlg).getByTestId("signin-info").textContent).toMatch(/found the user/);
    expect(within(dlg).getByTestId("signin-username").readOnly).toBe(true);
    expect(within(dlg).getByTestId("signin-code")).toBeTruthy();
    expect(within(dlg).getByTestId("signin-new").getAttribute("type")).toBe("password");
    expect(within(dlg).getByTestId("signin-confirm").getAttribute("type")).toBe("password");
    expect(calls.every((c) => c.path.startsWith("/api/")), "no redirect and no other origin").toBe(true);
  });

  test("Email me a code asks the server and shows its fixed message; a refusal shows PingOne's reason in the dialog", async () => {
    let sent = 0;
    stub({
      "/api/signin/forgot": () => ({ status: 200, body: { signedIn: false, next: "recovery_code", message: "m" } }),
      "/api/signin/code": () => (sent++ === 0 ? { status: 200, body: { signedIn: false, next: "recovery_code", message: "A recovery code was sent to the email address of the user." } } : { status: 429, body: { error: "too_soon", message: "a code was sent a moment ago; wait 20 seconds before asking for another" } }),
    });
    const { dlg, u } = await open();
    await u.click(await within(dlg).findByTestId("signin-forgot"));
    await u.click(await within(dlg).findByTestId("signin-send-code"));
    await waitFor(() => expect(within(dlg).getByTestId("signin-info").textContent).toMatch(/recovery code was sent/));
    await u.click(within(dlg).getByTestId("signin-send-code"));
    expect((await within(dlg).findByTestId("signin-error")).textContent).toMatch(/wait 20 seconds.*HTTP 429/);
  });

  test("the code and the new password are sent once, both fields are cleared, and a good answer signs in and hands the body to the page", async () => {
    stub({
      "/api/signin/forgot": () => ({ status: 200, body: { signedIn: false, next: "recovery_code", message: "m" } }),
      "/api/signin/recover": () => ({ status: 200, body: { signedIn: true, user: { name: "demo-user" }, steps: [] } }),
    });
    const { dlg, u, onSignedIn } = await open();
    await u.click(await within(dlg).findByTestId("signin-forgot"));
    await u.type(await within(dlg).findByTestId("signin-code"), ` ${CODE.toLowerCase()}!`);
    expect(within(dlg).getByTestId("signin-code").value, "only letters and digits are kept").toBe(CODE.toLowerCase());
    await u.type(within(dlg).getByTestId("signin-new"), NEW_PW);
    await u.type(within(dlg).getByTestId("signin-confirm"), NEW_PW);
    await u.click(within(dlg).getByTestId("signin-submit"));
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledTimes(1));
    expect(posts("/api/signin/recover")).toHaveLength(1);
    expect(posts("/api/signin/recover")[0].body).toEqual({ recoveryCode: CODE.toLowerCase(), newPassword: NEW_PW });
    expect(document.body.innerHTML.includes(NEW_PW), "the new password is in no part of the page").toBe(false);
  });

  test("two different new passwords are refused in the dialog before anything is sent", async () => {
    stub({ "/api/signin/forgot": () => ({ status: 200, body: { signedIn: false, next: "recovery_code", message: "m" } }) });
    const { dlg, u } = await open();
    await u.click(await within(dlg).findByTestId("signin-forgot"));
    await u.type(await within(dlg).findByTestId("signin-code"), CODE);
    await u.type(within(dlg).getByTestId("signin-new"), NEW_PW);
    await u.type(within(dlg).getByTestId("signin-confirm"), NEW_PW + "x");
    await u.click(within(dlg).getByTestId("signin-submit"));
    expect((await within(dlg).findByTestId("signin-error")).textContent).toMatch(/not the same/);
    expect(posts("/api/signin/recover")).toHaveLength(0);
    expect(within(dlg).getByTestId("signin-new").value).toBe("");
  });

  test("a wrong code shows PingOne's refusal and clears the secrets; Back to sign in and Cancel both end the waiting recovery", async () => {
    stub({
      "/api/signin/forgot": () => ({ status: 200, body: { signedIn: false, next: "recovery_code", message: "m" } }),
      "/api/signin/recover": () => ({ status: 401, body: { error: "recovery_rejected", message: "PingOne did not accept the code or the new password." } }),
      "/api/signin/cancel": () => ({ status: 200, body: { cancelled: true } }),
    });
    const { dlg, u, onClose } = await open();
    await u.click(await within(dlg).findByTestId("signin-forgot"));
    await u.type(await within(dlg).findByTestId("signin-code"), "WRONG123");
    await u.type(within(dlg).getByTestId("signin-new"), NEW_PW);
    await u.type(within(dlg).getByTestId("signin-confirm"), NEW_PW);
    await u.click(within(dlg).getByTestId("signin-submit"));
    expect((await within(dlg).findByTestId("signin-error")).textContent).toMatch(/did not accept the code.*HTTP 401/);
    expect(within(dlg).getByTestId("signin-code").value).toBe("");
    expect(document.body.innerHTML.includes(NEW_PW)).toBe(false);
    await u.click(within(dlg).getByTestId("signin-back"));
    await within(dlg).findByTestId("signin-form");
    expect(posts("/api/signin/cancel")).toHaveLength(1);
    await u.click(await within(dlg).findByTestId("signin-forgot"));
    await within(dlg).findByTestId("signin-recover-form");
    await u.click(within(dlg).getByTestId("signin-cancel"));
    expect(onClose).toHaveBeenCalled(); expect(posts("/api/signin/cancel")).toHaveLength(2);
  });
});

describe("the link follows PingOne's own sign-on policy", () => {
  test("the dialog asks the server whether PingOne offers recovery and shows the link only when it does", async () => {
    stub({});
    const { dlg } = await open();
    await within(dlg).findByTestId("signin-forgot");
    expect(calls.filter((c) => c.path === "/api/signin/options")).toHaveLength(1);
  });
  test("no link when PingOne's policy does not offer it, when the answer is an error, or when the server cannot be asked; the password form is unchanged", async () => {
    for (const answer of [() => ({ status: 200, body: { recovery: false } }), () => ({ status: 500, body: { error: "x" } }), null]) {
      stub(answer ? { "/api/signin/options": answer } : { "/api/signin/options": undefined });
      if (!answer) vi.stubGlobal("fetch", async () => { throw new Error("offline"); });
      const { dlg } = await open();
      await within(dlg).findByTestId("signin-password");
      await new Promise((r) => setTimeout(r, 30));
      expect(within(dlg).queryByTestId("signin-forgot")).toBeNull();
      expect(within(dlg).getByTestId("signin-submit")).toBeTruthy();
      cleanup();
    }
  });
});

describe("Choose a new password", () => {
  const holdAnswers = () => ({
    "/api/signin": () => ({ status: 200, body: { signedIn: false, next: "change_password", message: "PingOne asks you to choose a new password before signing in." } }),
    "/api/signin/change": (b) => (b.currentPassword === OLD_PW ? { status: 200, body: { signedIn: true, user: { name: "demo-user" }, steps: [] } } : { status: 401, body: { error: "change_rejected", message: "PingOne did not accept the current password or the new one." } }),
    "/api/signin/cancel": () => ({ status: 200, body: { cancelled: true } }),
  });
  test("when PingOne holds the sign-in for a temporary password the dialog switches to the change step and says why", async () => {
    stub(holdAnswers());
    const { dlg, u } = await open();
    await u.type(within(dlg).getByTestId("signin-password"), OLD_PW);
    await u.click(within(dlg).getByTestId("signin-submit"));
    await within(dlg).findByTestId("signin-change-form");
    expect(within(dlg).getByTestId("fd-titlebar").textContent).toMatch(/Choose a new password/);
    expect(within(dlg).getByTestId("signin-info").textContent).toMatch(/choose a new password/);
    for (const id of ["signin-current", "signin-new", "signin-confirm"]) expect(within(dlg).getByTestId(id).getAttribute("type")).toBe("password");
    expect(posts("/api/signin")[0].body).toEqual({ password: OLD_PW });
  });

  test("both passwords go to the server once; a wrong current password is refused and everything is cleared; the right one signs in", async () => {
    stub(holdAnswers());
    const { dlg, u, onSignedIn } = await open();
    await u.type(within(dlg).getByTestId("signin-password"), OLD_PW);
    await u.click(within(dlg).getByTestId("signin-submit"));
    await u.type(await within(dlg).findByTestId("signin-current"), "not-the-current-1");
    await u.type(within(dlg).getByTestId("signin-new"), NEW_PW);
    await u.type(within(dlg).getByTestId("signin-confirm"), NEW_PW);
    await u.click(within(dlg).getByTestId("signin-submit"));
    expect((await within(dlg).findByTestId("signin-error")).textContent).toMatch(/did not accept the current password.*HTTP 401/);
    expect(within(dlg).getByTestId("signin-current").value).toBe("");
    expect(document.body.innerHTML.includes("not-the-current-1") || document.body.innerHTML.includes(NEW_PW)).toBe(false);
    await u.type(within(dlg).getByTestId("signin-current"), OLD_PW);
    await u.type(within(dlg).getByTestId("signin-new"), NEW_PW);
    await u.type(within(dlg).getByTestId("signin-confirm"), NEW_PW);
    await u.click(within(dlg).getByTestId("signin-submit"));
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledTimes(1));
    expect(posts("/api/signin/change").map((c) => c.body)).toEqual([{ currentPassword: "not-the-current-1", newPassword: NEW_PW }, { currentPassword: OLD_PW, newPassword: NEW_PW }]);
  });

  test("after a recovery PingOne may ask for a normal sign-in: the dialog goes back to the password step with the server's note", async () => {
    stub({
      "/api/signin/forgot": () => ({ status: 200, body: { signedIn: false, next: "recovery_code", message: "m" } }),
      "/api/signin/recover": () => ({ status: 200, body: { signedIn: false, next: "password", message: "The password was changed. Sign in with the new password." } }),
    });
    const { dlg, u } = await open();
    await u.click(await within(dlg).findByTestId("signin-forgot"));
    await u.type(await within(dlg).findByTestId("signin-code"), CODE);
    await u.type(within(dlg).getByTestId("signin-new"), NEW_PW);
    await u.type(within(dlg).getByTestId("signin-confirm"), NEW_PW);
    await u.click(within(dlg).getByTestId("signin-submit"));
    await within(dlg).findByTestId("signin-form");
    expect(within(dlg).getByTestId("signin-info").textContent).toMatch(/Sign in with the new password/);
    expect(within(dlg).getByTestId("signin-password").value).toBe("");
  });
});
