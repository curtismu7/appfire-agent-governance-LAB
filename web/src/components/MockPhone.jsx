// The mock phone (owner 2026-11-13): a REUSABLE human-approval component, ported from AI-DEMO2's
// ConsentMockPhoneFlow (start / poll / decision against the lab's approval service) onto this family's
// FloatingDialog. Reusable means: no run or use-case knowledge — the host hands it an approval session
// (from POST /api/approval/start) and callbacks; the phone handles pending → approved | denied | expired,
// the lock-screen card, and the approve/deny press. The host decides what an approval means (retry a Real
// call with the receipt, discharge a Mock hold, ...).
//
// Props:
//   approval          the session object from /api/approval/start ({ id, state, tool, amount, description, ... })
//   onClose()         the phone was dismissed (the session keeps its state; the host can reopen later)
//   onDecided(state)  called once when the session ends: 'approved' | 'denied' | 'expired'
//   onError(message)  a failed start is the host's business; here: only network errors on decide
//   reopenable        when true (default) a dismissed pending phone shows an "Open mock phone" button again
import { useEffect, useRef, useState } from 'react';
import FloatingDialog from '../floating-dialog/FloatingDialog';
import { getJson, postJson } from '../api';

const POLL_MS = 2000;
const STATES = {
  approved: { tone: 'ok', word: 'Approved', sentence: 'Approved on the phone. The approval is recorded and the lab proceeds.' },
  denied: { tone: 'danger', word: 'Denied', sentence: 'Denied on the phone. The call stays refused and nothing was sent to the tool.' },
  expired: { tone: 'warn', word: 'Expired', sentence: 'Nobody answered in time. The hold stands and nothing was sent to the tool.' },
};

export default function MockPhone({ approval, onClose, onDecided, onError, reopenable = true }) {
  const [view, setView] = useState(approval);
  const [error, setError] = useState('');
  const [closed, setClosed] = useState(false);
  const reported = useRef(false);
  const [answering, setAnswering] = useState(false); // state: the ref form was passed to disabled (always truthy) and never re-rendered
  const id = approval?.id;

  // A new session (a new id) restarts the phone.
  useEffect(() => { if (approval) { setView(approval); setError(''); setClosed(false); reported.current = false; } }, [id]);

  // Poll while pending, like a real CIBA client would.
  useEffect(() => {
    if (view?.state !== 'pending' || !id) return undefined;
    const timer = setInterval(() => {
      getJson(`/api/approval/status?id=${encodeURIComponent(id)}`)
        .then((b) => { if (b.approval) { setView(b.approval); if (STATES[b.approval.state]) setError(''); } })
        .catch(() => {});
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [view?.state, id]);

  useEffect(() => {
    if (reported.current || !STATES[view?.state]) return;
    reported.current = true;
    onDecided?.(view.state);
  }, [view?.state]);

  const answer = (approved) => {
    if (answering || !id) return;
    setAnswering(true);
    setError('');
    postJson('/api/approval/decide', { id, approved }, {})
      .then((r) => { if (r.ok && r.body?.approval) setView(r.body.approval); else setError(r.body?.detail || 'The mock phone could not answer.'); })
      .catch(() => setError('The mock phone could not answer.'))
      .finally(() => setAnswering(false));
  };

  const pending = view?.state === 'pending';
  const chip = STATES[view?.state];
  const money = Number.isFinite(view?.amount) ? `$${Number(view.amount).toLocaleString()}` : null;

  const phone = (
    <div className="mp" data-testid="mock-phone">
      <div className="mp__screen">
        <div className="mp__island" aria-hidden="true" />
        <div className="mp__clock" aria-hidden="true"><span className="mp__date">Lock screen</span><span className="mp__time">9:41</span></div>
        <div className="mp__card">
          <p className="mp__app"><span className="mp__icon" aria-hidden="true">P</span>PingOne Approve (mock)<span className="mp__now">now</span></p>
          <h3>{view?.tool ? `Approve ${view.tool}?` : 'Approve this request?'}</h3>
          {view?.description && <p className="mp__desc">{view.description}</p>}
          {money && <p className="mp__amount">{money}</p>}
        </div>
        <div className="mp__actions">
          <button type="button" className="mp__approve" onClick={() => answer(true)} disabled={answering} data-testid="mp-approve">Approve on mock phone</button>
          <button type="button" className="mp__deny" onClick={() => answer(false)} disabled={answering} data-testid="mp-deny">Deny on mock phone</button>
        </div>
        <div className="mp__home" aria-hidden="true" />
      </div>
    </div>
  );

  return (
    <div className="mp-host">
      {error && <p className="field-error" role="alert" data-testid="mp-error">{error}</p>}
      {pending && (
        <p className="muted" role="status" data-testid="mp-pending">
          Waiting for a person to answer on their device (mock).{closed && reopenable && (
            <> <button type="button" onClick={() => setClosed(false)} data-testid="mp-reopen">Open mock phone</button></>
          )}
        </p>
      )}
      {STATES[view?.state] && (
        <p className={`muted ${view.state === 'approved' ? 'mp-ok' : 'mp-bad'}`} role="status" data-testid="mp-outcome">
          <strong>{chip.word}.</strong> {chip.sentence}
        </p>
      )}
      <FloatingDialog isOpen={pending && !closed} onClose={() => { setClosed(true); onClose?.(); }} title="Mock phone"
        ariaLabel="Mock phone lock screen" defaultWidth={340} defaultHeight={620} placement="right" storageKey="aag.mock-phone" testId="mock-phone-dialog">
        {phone}
      </FloatingDialog>
    </div>
  );
}
