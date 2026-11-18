import { useEffect, useRef, useState } from "react";
import FloatingDialog from "../floating-dialog/FloatingDialog";
import { postJson } from "../api";
import { newTraceparent } from "../lib";
import { visible } from "../safeText";

// The standard Sign in modal for full Real (owner rules: the password step is this modal, never an inline form; login is pi.flow only, never a
// redirect). The lab's server drives PingOne's pi.flow: authorize (response_mode=pi.flow, PKCE S256), the flows API username/password step,
// then the code for tokens. The username comes from the server (AAG_DEMO_USERNAME) and is read-only here. Every password and the recovery code live in
// this component's state only while the dialog is open: each is cleared the moment it is sent, on close and on unmount, and the page never shows it back.
//
// Two more steps (owner, 2026-11-17), both PingOne's own flows API actions run by the lab's server:
//   "Forgot password?"  -> PingOne looks the user up, the person asks for a code by email, then types the code and a new password;
//   "Choose a new password" -> when PingOne holds the sign-in for a temporary or expired password.
// Modes: password (the default), recover, change. The server says which one is next (`next` in its answer).
const TITLES = { password: "Sign in", recover: "Forgot password", change: "Choose a new password" };
const NEXT_MODE = { recovery_code: "recover", change_password: "change", password: "password" };

export default function SignInDialog({ isOpen, username, onClose, onSignedIn }) {
  const [mode, setMode] = useState("password");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [current, setCurrent] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [info, setInfo] = useState(null);
  const firstRef = useRef(null);
  const wipe = () => { setPassword(""); setCode(""); setCurrent(""); setNewPw(""); setConfirm(""); };
  const reset = () => { wipe(); setMode("password"); setError(null); setInfo(null); setBusy(false); };
  useEffect(() => { if (!isOpen) reset(); }, [isOpen]);
  useEffect(() => () => wipe(), []);
  // A step the person leaves must not leave a flow waiting on the server.
  const cancelWaiting = () => { if (mode !== "password") postJson("/api/signin/cancel", {}, { traceparent: newTraceparent() }).catch(() => {}); };
  const close = () => { cancelWaiting(); wipe(); onClose?.(); };

  // One answer for every step: signed in, or the next step the server asks for, or a fixed-text error.
  const call = async (path, payload) => {
    setBusy(true); setError(null); setInfo(null);
    const res = await postJson(path, payload, { traceparent: newTraceparent() }).catch(() => ({ ok: false, status: 0, body: { message: "The server did not answer." } }));
    setBusy(false);
    if (res.ok && res.body?.signedIn) { onSignedIn?.(res.body); return res; }
    if (res.ok && res.body?.next && NEXT_MODE[res.body.next]) {
      setMode(NEXT_MODE[res.body.next]); setInfo(res.body.message ? String(res.body.message) : null);
      return res;
    }
    setError(`${res.body?.message || res.body?.detail || "Sign-in failed."}${res.status ? ` (HTTP ${res.status})` : ""}`);
    return res;
  };
  useEffect(() => { if (isOpen) firstRef.current?.focus(); }, [mode, isOpen]);

  const submitPassword = async (e) => {
    e.preventDefault();
    if (busy || !password) return;
    const sent = password;
    setPassword(""); // cleared at once: nothing keeps the password after it is sent
    await call("/api/signin", { password: sent });
  };
  const forgot = async () => { if (!busy) { wipe(); await call("/api/signin/forgot", {}); } };
  const sendCode = async () => {
    if (busy) return;
    const res = await call("/api/signin/code", {});
    if (res.ok && !res.body?.signedIn) setInfo(res.body?.message ? String(res.body.message) : "A recovery code was sent.");
  };
  const differ = () => { setError("The two new passwords are not the same. Type them again."); setNewPw(""); setConfirm(""); };
  const submitRecover = async (e) => {
    e.preventDefault();
    if (busy || !code || !newPw) return;
    if (newPw !== confirm) return differ();
    const [c, n] = [code, newPw];
    wipe();
    await call("/api/signin/recover", { recoveryCode: c.trim(), newPassword: n });
  };
  const submitChange = async (e) => {
    e.preventDefault();
    if (busy || !current || !newPw) return;
    if (newPw !== confirm) return differ();
    const [c, n] = [current, newPw];
    wipe();
    await call("/api/signin/change", { currentPassword: c, newPassword: n });
  };
  const backToSignIn = () => { cancelWaiting(); wipe(); setMode("password"); setError(null); setInfo(null); };

  const formId = `signin-form-${mode}`;
  const ready = mode === "password" ? Boolean(password) : mode === "recover" ? Boolean(code && newPw && confirm) : Boolean(current && newPw && confirm);
  const label = { password: busy ? "Signing in..." : "Sign in", recover: busy ? "Working..." : "Set the password and sign in", change: busy ? "Working..." : "Change the password and sign in" }[mode];
  // The action row is the dialog's footer, outside the scrolling body: the fields can never slide under it, and it stays in view on a short window.
  const actions = (
    <>
      {mode !== "password" && <button type="button" onClick={backToSignIn} disabled={busy} data-testid="signin-back">Back to sign in</button>}
      <button type="button" onClick={close} data-testid="signin-cancel">Cancel</button>
      <button type="submit" form={formId} className="primary" disabled={busy || !ready} data-testid="signin-submit">{label}</button>
    </>
  );
  const feedback = (
    <>
      {info && <p className="muted" role="status" data-testid="signin-info">{visible(info)}</p>}
      {error && <p className="field-error" role="alert" data-testid="signin-error">{visible(error)}</p>}
    </>
  );
  const passwordField = (id, value, set, text, ref, auto = "new-password") => (
    <label className="field">
      <span className="field-label">{text}</span>
      <input ref={ref} type="password" name={id} value={value} onChange={(e) => set(e.target.value.slice(0, 256))} autoComplete={auto} required maxLength={256} data-testid={`signin-${id}`} />
    </label>
  );
  const usernameField = (
    <>
      <label className="field">
        <span className="field-label">Username</span>
        <input type="text" name="username" value={username || ""} readOnly autoComplete="username" data-testid="signin-username" aria-describedby="signin-username-note" />
      </label>
      <p className="muted" id="signin-username-note">Filled in from this lab's settings (AAG_DEMO_USERNAME).</p>
    </>
  );
  return (
    <FloatingDialog isOpen={isOpen} onClose={close} title={TITLES[mode]} ariaLabel={TITLES[mode]} defaultWidth={420} defaultHeight={null} defaultY={16} footer={actions} testId="signin-dialog" storageKey="aag.signin">
      {mode === "password" && (
        <form id={formId} className="stack" onSubmit={submitPassword} data-testid="signin-form">
          <p className="muted" data-testid="signin-method">Sign-in with PingOne, <strong>pi.flow</strong>: this lab's server sends your password once to PingOne's flows API. No redirect, and the password is never stored, logged or shown.</p>
          {usernameField}
          <label className="field">
            <span className="field-label">Password</span>
            <input ref={firstRef} type="password" name="password" value={password} onChange={(e) => setPassword(e.target.value.slice(0, 256))} autoComplete="current-password" required maxLength={256} data-testid="signin-password" autoFocus />
          </label>
          <p className="muted"><button type="button" className="signin__link" onClick={forgot} disabled={busy} data-testid="signin-forgot">Forgot password?</button></p>
          {feedback}
        </form>
      )}
      {mode === "recover" && (
        <form id={formId} className="stack" onSubmit={submitRecover} data-testid="signin-recover-form">
          <p className="muted" data-testid="signin-method">PingOne's own password recovery over pi.flow: it emails a one-time code to the user, and the code and the new password go to PingOne once. Nothing is stored, logged or shown.</p>
          {usernameField}
          <p className="muted"><button type="button" className="signin__link" onClick={sendCode} disabled={busy} data-testid="signin-send-code">Email me a code</button> (one every 20 seconds; the code has 8 characters and lasts 5 minutes)</p>
          <label className="field">
            <span className="field-label">Recovery code</span>
            <input ref={firstRef} type="text" name="code" value={code} onChange={(e) => setCode(e.target.value.replace(/[^A-Za-z0-9]/g, "").slice(0, 16))} autoComplete="one-time-code" required maxLength={16} data-testid="signin-code" />
          </label>
          {passwordField("new", newPw, setNewPw, "New password")}
          {passwordField("confirm", confirm, setConfirm, "New password again")}
          {feedback}
        </form>
      )}
      {mode === "change" && (
        <form id={formId} className="stack" onSubmit={submitChange} data-testid="signin-change-form">
          <p className="muted" data-testid="signin-method">PingOne holds the sign-in until the password is changed. Both passwords go to PingOne once; nothing is stored, logged or shown.</p>
          {usernameField}
          {passwordField("current", current, setCurrent, "Current (temporary) password", firstRef, "current-password")}
          {passwordField("new", newPw, setNewPw, "New password")}
          {passwordField("confirm", confirm, setConfirm, "New password again")}
          {feedback}
        </form>
      )}
    </FloatingDialog>
  );
}
