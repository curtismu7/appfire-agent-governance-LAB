import { useCallback, useEffect, useRef, useState } from "react";
import UseCasePicker from "./components/UseCasePicker";
import RunPanel from "./components/RunPanel";
import DiagramView from "./components/DiagramView";
import ExtraPage from "./components/ExtraPage";
import RunHistory from "./components/RunHistory";
import TalkTrack from "./components/TalkTrack";
import AgentColumn, { statusOf } from "./components/AgentColumn";
import EvidenceColumn from "./components/EvidenceColumn";
import FullPageEvidence from "./components/FullPageEvidence";
import QuickConfig from "./components/QuickConfig";
import SetupSidebar, { VerticalSelect } from "./components/SetupSidebar";
import Rail from "./rail/Rail";
import { getJson, postJson, resetWorkspace } from "./api";
import { BANNER_HOSTED, BANNER_LOCAL, DEFAULT_VERTICAL, EXTRAS, OWN_TOOL_VERTICALS, focusHop, holdWords, newTraceparent, setUseCaseTitles, titleOfUc } from "./lib";
import { matchPrompt, pickStands, reasoningOf } from "./chat";
import { isHandoff } from "./handoff";
import { FARE_PHONE_APPROVED } from "./fare";
import { chooseTab, cleanConfig, loadConfig, saveConfig, setView } from "./quickConfig";
import { workspaceId } from "./workspace";
import { loadResume, saveResume, takeReturn } from "./resume";
import ShelfLink from "./components/ShelfLink.jsx";
import VerifyMark from "./components/VerifyMark.jsx";
import DemoGuide from "./components/DemoGuide";
import AgendaSteps from "./components/AgendaSteps";
import ComparePage from "./components/ComparePage";
import AgentInstructions from "./components/AgentInstructions";
import { DEMO_GUIDE } from "./demoGuide";
import MockPhone from "./components/MockPhone";
import SignInDialog from "./components/SignInDialog";
import TopMenu, { applyFontSize } from "./top-menu/TopMenu.jsx";
import "./top-menu/top-menu.css";
import "./layout.css";

// The nav holds the agent's own areas only. An extra page joins the "More" menu beside it when a run of a use case that opens it succeeds, and
// Reset removes it (one menu, so the shell bar stays one row however many extra pages are open).
export const BASE_NAV = [
  { id: "agent", label: "Agent" },
  { id: "runs", label: "Run history" },
  { id: "diagram", label: "Diagram" },
  { id: "talk", label: "Talk track" },
];
const EXTRA_PREFIX = "page-";
// Full-page evidence views of the agent area (#sequence, #reel, #compare): the nav keeps Agent selected.
export const FULL_PAGES = ["sequence", "reel", "compare"];
// Talk-track entry ids shown under the step bar on the pages other than Agent; on the Agent page the notes are the entries whose `step` is the current walkthrough step.
const PRESENTER_TALK = { runs: ["audit", "honesty"], diagram: ["say-first"], talk: [], extra: ["honesty"] };
const THEME_KEY = "cal.theme";
const THEMES = [["auto", "Auto"], ["light", "Light"], ["dark", "Dark"]];

const FONT_KEY = "aag-font-step";
const savedTheme = () => { try { const t = window.localStorage.getItem(THEME_KEY); return THEMES.some(([id]) => id === t) ? t : "auto"; } catch { return "auto"; } };
const applyTheme = (t) => { const root = document.documentElement; if (t === "light" || t === "dark") root.setAttribute("data-theme", t); else root.removeAttribute("data-theme"); };
const viewFromHash = () => window.location.hash.replace("#", "");
// fare: the Human approval page tells how a risky write is held and released; on the airline pack it opens only for a run that actually held (a booking that was
// allowed or narrowed has nothing held to show).
const askedAPerson = (run) => (run.hops || []).some((h) => ["step-up", "tool-held", "ciba-authorize"].includes(h.kind) && h.verdict !== "skip");
const resultKey = (id, vertical, persona, mode) => `${id}|${vertical}|${persona}|${mode}`;

export default function App() {
  // Resume (sessionStorage per workspace, ids and shown text only; see resume.js), read once before the first render, and ONLY when the page
  // loads with a valid ?returned=<known app>&uc=<id> (Back from a hand-off). A plain load or reload starts fresh, as before.
  const [back] = useState(() => takeReturn());
  const [resumed] = useState(() => (back ? loadResume(workspaceId()) : null));
  const [info, setInfo] = useState(null);
  const [story, setStory] = useState(null);
  const [mode, setMode] = useState(null);
  const [servedBanner] = useState(() => { try { return document.querySelector('[data-testid="banner"][data-state="hosted"]')?.textContent || null; } catch { return null; } });
  const [modeMsg, setModeMsg] = useState("");
  const [modeFailed, setModeFailed] = useState(false);
  const [vertical, setVertical] = useState(resumed?.vertical || DEFAULT_VERTICAL);
  const [persona, setPersona] = useState(resumed?.persona || "standard");
  const [catalog, setCatalog] = useState(null);
  const [prompts, setPrompts] = useState([]);
  const [instrConfig, setInstrConfig] = useState(null); // the default instructions, the presets and the override phrases (GET /api/instructions)
  const [instrEdit, setInstrEdit] = useState(null); // the edited instructions, or null while the default is in use
  const [selectedId, setSelectedId] = useState(resumed?.selectedId ?? null);
  const [results, setResults] = useState({});
  const [running, setRunning] = useState(false);
  const [opened, setOpened] = useState({});
  const [last, setLast] = useState(null);
  const [runCount, setRunCount] = useState(0);
  const [view, setView_] = useState(viewFromHash());
  const [theme, setThemeState] = useState(savedTheme);
  const [fontStep, setFontStep] = useState(() => { try { return window.localStorage.getItem(FONT_KEY) || "M"; } catch { return "M"; } });
  useEffect(() => { applyFontSize(fontStep); try { window.localStorage.setItem(FONT_KEY, fontStep); } catch { /* storage blocked */ } }, [fontStep]);
  const [cfg, setCfg] = useState(() => loadConfig(workspaceId()));
  const [qcOpen, setQcOpen] = useState(false);
  const [turns, setTurns] = useState(resumed?.turns || []);
  const [selHop, setSelHop] = useState(null);
  const [several, setSeveral] = useState(false);
  const [sessions, setSessions] = useState([]);
  const [resetSignal, setResetSignal] = useState(0);
  const [resetMsg, setResetMsg] = useState("");
  const [error, setError] = useState(null);
  // Full Real (owner, 2026-11-10): who is signed in for this workspace, the Sign in dialog, and the run that waits for the sign-in.
  const [signin, setSignin] = useState(null);
  const [signOpen, setSignOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  // The talk track floats over every tab (owner 2026-11-13): opening the talk tab opens it; it stays open while you
  // demo on other tabs, until you close the dialog itself. select() opens it; the dialog's own close unopens.
  const [talkOpen, setTalkOpen] = useState(false);
  const [guideRunning, setGuideRunning] = useState(null); // the use case a guide step's Run button started
  const [comparePreset, setComparePreset] = useState(null); // the pair a guide step's Compare button opened the Compare page at
  const [agendaStep, setAgendaStep] = useState(0); // the walkthrough step shown in presenter mode (demoGuide.js)
  // The mock phone (owner 2026-11-13): opens when a run holds for approval — a REAL_HOLD with the gateway's challenge,
  // or a mock HITL/step-up hold. kind real = the approval is recorded with the SE HITL service and the run is retried
  // with the verified receipt; kind mock = the approval discharges the lab's simulated obligation.
  const [phoneApproval, setPhoneApproval] = useState(null);
  const pendingRun = useRef(null);
  const runRef = useRef(null);
  const runSeq = useRef(0);
  const turnSeq = useRef(resumed?.turns.length || 0);
  useEffect(() => { saveResume(workspaceId(), { turns, selectedId, vertical, persona }); }, [turns, selectedId, vertical, persona]);
  // Back from a hand-off: the chat above is already restored and the address bar cleaned (takeReturn); select the use case and add a short
  // note, unless the last turn is already that same note.
  useEffect(() => {
    if (!back) return;
    setSelectedId(back.uc);
    const said = `Back from ${back.app}`;
    setTurns((ts) => (ts.length && ts[ts.length - 1].status === "note" && ts[ts.length - 1].said === said ? ts : [...ts, { id: ++turnSeq.current, status: "note", said }]));
  }, [back]);

  const presenter = cfg.presenter;
  const setPresenter = useCallback((f) => setCfg((c) => ({ ...c, presenter: typeof f === "function" ? f(c.presenter) : f })), []);
  useEffect(() => { saveConfig(workspaceId(), cfg); }, [cfg]);
  useEffect(() => { applyTheme(theme); }, [theme]);
  const setTheme = (t) => { setThemeState(t); try { window.localStorage.setItem(THEME_KEY, t); } catch { /* storage blocked */ } };

  // The lab opens in the mode the server derived (Real when it is fully configured). If the server does not answer, the mode stays unknown and the page says so.
  const loadMode = useCallback(() => getJson("/api/mode").then((m) => { setMode(m.mode); setModeFailed(false); }, () => setModeFailed(true)), []);
  useEffect(() => { getJson("/api/info").then(setInfo, (e) => setError(e.message)); loadMode(); }, [loadMode]);
  // A resumed vertical id the server no longer has (a removed stub, a deploy in between) falls back to the default; the failed loads of the stale id are cleared.
  useEffect(() => { if (info?.verticals && !info.verticals.some((v) => v.id === vertical)) { setVertical(DEFAULT_VERTICAL); setError(null); } }, [info]); // eslint-disable-line react-hooks/exhaustive-deps
  const realLevel = info?.real?.level ?? null;
  const loadSignin = useCallback(() => getJson("/api/signin").then(setSignin, () => setSignin(null)), []);
  useEffect(() => { if (realLevel === "full") loadSignin(); }, [realLevel, loadSignin]);
  // The llama.cpp brain: is it configured, and (only once the visitor has picked it) does the model answer. The plain call touches no model.
  const [brainInfo, setBrainInfo] = useState(null);
  useEffect(() => { getJson(`/api/brain${cfg.brain === "llama" ? "?check=1" : ""}`).then(setBrainInfo, () => setBrainInfo({ configured: false, available: false, message: "The server did not answer." })); }, [cfg.brain]);

  // The story (banner, talk track, cast) comes from a full vertical; a stub has none, so the last good story stays.
  const verticalInfo = info?.verticals.find((v) => v.id === vertical);
  useEffect(() => {
    if (info && verticalInfo?.pack !== "full") return undefined;
    let live = true;
    getJson(`/api/story?vertical=${encodeURIComponent(vertical)}`).then((j) => { if (live) setStory(j); }, (e) => { if (live && e.status !== 501) setError(e.message); });
    return () => { live = false; };
  }, [vertical, info]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let live = true; // a late catalog for a vertical the visitor has already left is dropped
    getJson(`/api/usecases?vertical=${encodeURIComponent(vertical)}`).then((j) => { if (live) setCatalog(j); }, (e) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [vertical]);
  useEffect(() => {
    let live = true; // the agent's instructions for this vertical; an edit made for another vertical is dropped (it names that vertical's money)
    setInstrConfig(null); setInstrEdit(null);
    getJson(`/api/instructions?vertical=${encodeURIComponent(vertical)}`).then((j) => { if (live) setInstrConfig(j); }, () => {});
    return () => { live = false; };
  }, [vertical]);
  useEffect(() => {
    let live = true; // What to type for this vertical; a failure leaves the list empty (the catalog error already speaks for a dead server)
    setPrompts([]);
    getJson(`/api/prompts?vertical=${encodeURIComponent(vertical)}`).then((j) => { if (live) setPrompts(Array.isArray(j.prompts) ? j.prompts : []); }, () => {});
    return () => { live = false; };
  }, [vertical]);
  useEffect(() => {
    let live = true;
    getJson("/api/runs").then((j) => { if (live) setSessions((j.runs || []).slice(-6).reverse()); }, () => {});
    return () => { live = false; };
  }, [runCount]);
  useEffect(() => {
    const on = () => setView_(viewFromHash());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  useEffect(() => {
    const on = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return; // Cmd/Ctrl+P is the browser's print, not presenter mode
      if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      if (e.key === "p" || e.key === "P") setPresenter((v) => !v);
      else if (e.key === "Escape") setPresenter(false);
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [setPresenter]);

  const extras = Object.keys(opened).filter((k) => Object.hasOwn(EXTRAS, k));
  const extraNav = extras.map((k) => ({ id: `${EXTRA_PREFIX}${k}`, label: EXTRAS[k].label, extra: true }));
  const nav = [...BASE_NAV, ...extraNav];
  const page = FULL_PAGES.includes(view) ? view : null;
  const current = page ? "agent" : nav.some((n) => n.id === view) ? view : "agent"; // a hash for a page that is not open falls back to the agent
  const select = (id) => { setView_(id); try { window.history.replaceState(null, "", `#${id}`); } catch { /* ignore */ } };
  // The talk track floats over every tab (owner 2026-11-13): selecting the talk tab opens it; it stays open across
  // tabs while you demo, until the dialog itself is closed.
  useEffect(() => { if (current === "talk") setTalkOpen(true); }, [current]);

  const allUc = catalog?.tracks.flatMap((t) => t.usecases) || [];
  setUseCaseTitles(allUc); // the words for each use case, for the places that only hold an id
  // A restored turn holds a use case id only; it gets the use case back from this vertical's catalog (another vertical's turn stays text only).
  const shownTurns = turns.map((t) => (t.restored && !t.uc && t.ucId && t.vertical === vertical ? { ...t, uc: allUc.find((u) => u.id === t.ucId) } : t));
  const uc = allUc.find((u) => u.id === selectedId) || null;
  const personas = info?.personas || ["standard", "premium"];
  const result = uc ? results[resultKey(uc.id, vertical, persona, mode)] : null;
  const evRun = result?.ok ? result.body.run : null;
  // The Why line above the evidence tabs: how the turn that made this run chose its use case, then what the run did (the chat shows the reply only).
  const evTurn = evRun ? [...turns].reverse().find((t) => t.result?.ok && t.result.body.run === evRun) : null;
  const why = evRun && uc ? reasoningOf(evTurn ? { ...evTurn, uc } : { uc, how: "picked" }, evRun) : null;
  const cast = story?.cast || {};
  const userId = persona === "premium" ? cast.castUser2 : cast.castUser;
  const verticals = info?.verticals || [];
  const stub = verticalInfo ? verticalInfo.pack !== "full" : false;

  // A use case whose lab inputs name a persona (UC21 needs premium) selects it, so the first Run gives the result the page shows and the README promises.
  const personaFor = (u) => { const needs = u?.labInputs?.persona; return needs && personas.includes(needs) ? needs : null; };
  const pick = (id) => {
    setSelectedId(id);
    setSelHop(null);
    const u = allUc.find((x) => x.id === id);
    const needs = personaFor(u);
    if (needs) setPersona(needs);
    // A hand-off picked from the list answers in the conversation, the same way a typed prompt does: the reasoning and the hand-off card.
    if (u && isHandoff(u)) { const tid = ++turnSeq.current; setTurns((ts) => [...ts, { id: tid, said: `${u.title} (picked from the list)`, uc: u, vertical, how: "picked", status: "handoff" }]); }
    // One column (phones, tablets): bring the answer into view, the hand-off reply for a hand-off, else the use case panel.
    setTimeout(() => {
      if (!window.matchMedia?.("(max-width: 900px)").matches) return;
      const target = u && isHandoff(u) ? [...document.querySelectorAll('[data-testid="turn"]')].pop() : runRef.current;
      target?.scrollIntoView?.({ block: "start" });
    }, 0);
  };

  const patchTurn = (id, patch) => setTurns((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  // One run of use case `u`. `turn` (optional) is the chat exchange it answers; `who` overrides the persona when the use case names one.
  const startRun = async (u, turn = null, who = persona, extra = null) => {
    if (!u || running) return;
    const mine = ++runSeq.current;
    const key = resultKey(u.id, vertical, who, mode);
    const tid = turn ? ++turnSeq.current : null;
    if (turn) setTurns((ts) => [...ts, { id: tid, uc: u, vertical, status: "running", ...turn }]);
    setRunning(true);
    // A typed or chip turn tells the server what was said and which brain actually picked the use case ("llama" only when llama.cpp did;
    // a fallback is "scripted"). A picked or previewed run sends neither.
    const typed = turn && turn.how !== "picked" ? { said: String(turn.said).slice(0, 400), brain: turn.how === "llm" ? "llama" : "scripted" } : {};
    const res = await postJson(`/api/run/${encodeURIComponent(u.id)}`, { vertical, persona: who, ...typed, ...(instrEdit !== null ? { instructions: instrEdit } : {}), ...(extra ?? {}) }, { traceparent: newTraceparent() }).catch(() => ({ ok: false, status: 0, body: { error: "network", detail: "The server did not answer. Is it running?" } }));
    if (mine !== runSeq.current) return; // a Reset or a newer run took over
    setRunning(false);
    // Real runs as the person: no sign-in yet opens the Sign in dialog, and the run goes again once it succeeds.
    if (res.status === 401 && res.body?.error === "sign_in_required") { pendingRun.current = { u, turn: turn ? { said: turn.said, how: turn.how, source: turn.source } : null, who }; setSignOpen(true); }
    // A use case the gateway cannot serve runs wholly on the lab's own engine; this refusal only happens when that engine is not available here (the server's words, shown as they are).
    if (res.status === 403 && res.body?.error === "mock_in_real_refused") setModeMsg(res.body.detail);
    setResults((r) => ({ ...r, [key]: res }));
    setRunCount((n) => n + 1);
    if (tid) patchTurn(tid, { status: "done", result: res });
    if (res.ok) {
      const run = res.body.run;
      setLast({ run, ucId: u.id });
      setSelHop(focusHop(run));
      if (run.kind !== "live" && Object.hasOwn(EXTRAS, u.opens) && !(run.fareRule && u.opens === "approval" && !askedAPerson(run))) setOpened((o) => ({ ...o, [u.opens]: { run, uc: u } }));
      // A hold opens the mock phone. Real: the server session carries the gateway's challenge; Mock: the lab mints one.
      const hold = run.outcome === "REAL_HOLD" && run.challenge ? "real"
        : ["HITL_REQUIRED", "STEP_UP", "REAL_HOLD"].includes(run.outcome) ? "mock" : null;
      if (hold) {
        postJson("/api/approval/start", {
          kind: hold, tool: run.real?.tool || (OWN_TOOL_VERTICALS.includes(vertical) ? u.tool : null) || u.primaryTool || null, // the pack's own tool name only where its pack is not the catalog's (software, airline); the other three keep the catalog name
          amount: run.booking?.fare ?? (run.real?.tool === "create_transfer" ? 300 : null), // fare: an airline booking shows the fare the rule judged
          description: holdWords(run.outcome),
          ...(hold === "real" ? { challengeId: run.challenge } : {}),
          // Which service minted the challenge (the server's own words, a fixed pair): the phone answers it there.
          ...(hold === "real" && ["se", "local"].includes(run.provider) ? { provider: run.provider } : {}),
        }).then((r) => { if (r.ok) setPhoneApproval(r.body.approval); }).catch(() => {});
      } else setPhoneApproval(null);
    }
  };
  const run = () => startRun(uc, { said: `Run “${uc?.title}” (picked from the list)`, how: "picked" });

  // The mock phone decided. On a REAL approval, retry the held use case with the approved session id — the server
  // swaps in the gateway challenge and the verified receipt discharges the consent obligation.
  const onPhoneDecided = (state) => {
    if (state !== "approved" || phoneApproval?.kind !== "real" || !last?.ucId || running) return;
    const u = allUc.find((x) => x.id === last.ucId);
    if (u) startRun(u, null, personaFor(u) || persona, { approvalId: phoneApproval.id });
  };

  // The demo guide's Run button: select the use case (which also sets the persona it needs), run it in the agent column.
  const talkRun = (step, uc) => {
    if (!step || !uc) return;
    guideRun({ uc });
  };
  // A guide step's Compare button: the Compare page (always Mock) at a named pair. The page is keyed by the pair, so a second button remounts it at that pair.
  const guideCompare = (step) => {
    if (!step?.preset) return;
    const at = DEMO_GUIDE.findIndex((g) => g.id === step.stepId);
    if (at >= 0) setAgendaStep(at);
    setComparePreset(step.preset);
    select("compare");
  };
  const guideRun = (step) => {
    if (!step?.uc) return;
    const at = DEMO_GUIDE.findIndex((g) => g.id === step.stepId);
    if (at >= 0) setAgendaStep(at);
    const u = allUc.find((x) => x.id === step.uc);
    if (current !== "agent" || page) select("agent"); // a run started from the guide or the talk track shows in the Agent column
    if (u && isHandoff(u)) {
      // A use case another app handles (the third-party call, for one) still runs here for the walkthrough, answered in the chat, without the hand-off card.
      setSelectedId(u.id); setSelHop(null); setGuideRunning(u.id);
      startRun(u, { said: `“${u.title}” (run from the walkthrough)`, how: "picked", walkthrough: true }, personaFor(u) || persona).finally(() => setGuideRunning(null));
      return;
    }
    pick(step.uc);
    if (!u) return;
    setGuideRunning(step.uc);
    startRun(u, null, personaFor(u) || persona).finally(() => setGuideRunning(null));
  };

  // The brain picks one use case of this vertical's What to type list, and the engine runs it. Scripted matches the words here. llama.cpp asks the
  // server, which returns only an id from that list (or a reason); when it cannot answer, Routing decides: Fallback uses Scripted and says so,
  // LLM only says so and runs nothing. Neither brain ever writes the answer.
  const [picking, setPicking] = useState(false);
  const busy = running || picking;
  // A pick in flight is dropped when the chat is reset, a new chat starts or the vertical changes: its answer belongs to the old context.
  const pickSeq = useRef(0);
  const dropPick = () => { pickSeq.current += 1; setPicking(false); };
  useEffect(() => { dropPick(); }, [vertical]);
  const answer = (said, source, m, brainNote) => {
    const u = m ? allUc.find((x) => x.id === m.uc) : null;
    if (!u) { const id = ++turnSeq.current; setTurns((ts) => [...ts, { id, said, status: "nomatch", source, brainNote }]); return; }
    const who = personaFor(u) || persona;
    setSelectedId(u.id); setSelHop(null); setPersona(who);
    if (isHandoff(u)) { const id = ++turnSeq.current; setTurns((ts) => [...ts, { id, said, uc: u, vertical, how: m.how, status: "handoff", source, brainNote }]); return; }
    startRun(u, { said, how: m.how, source, brainNote }, who);
  };
  const say = async (text, source) => {
    if (busy) return;
    const said = String(text).slice(0, 400);
    if (stub) return answer(said, source, null);
    if (cfg.brain !== "llama") return answer(said, source, matchPrompt(said, prompts, { strictNumbers: Boolean(cast.castFareRule) })); // fare: the airline pack never runs the staged fare for a different typed number
    const mine = ++pickSeq.current;
    setPicking(true);
    const res = await postJson("/api/brain/pick", { vertical, text: said }).catch(() => ({ ok: false, body: {} }));
    if (mine !== pickSeq.current) return; // a Reset, a new chat or another vertical took over
    setPicking(false);
    const b = res.ok ? res.body : { ok: false, message: res.body?.message || "The server did not answer." };
    const picked = b.ok && b.uc ? prompts.find((p) => p.uc === b.uc) : null;
    // fare: on the airline pack a model pick of a booking prompt is held to the same number guard as a typed match (the staged fare never stands in for a typed one).
    if (picked && !pickStands(said, picked.text, { strictNumbers: Boolean(cast.castFareRule) })) return answer(said, source, null, "llama.cpp picked a booking whose number is not the one you typed, so nothing ran.");
    if (picked) return answer(said, source, { uc: b.uc, how: "llm" });
    if (b.ok) return answer(said, source, null, "llama.cpp found no use case on this list for those words.");
    const why = `llama.cpp brain unavailable: ${b.message || "no reason given"}`;
    if (cfg.routing === "llm-only") return answer(said, source, null, `${why} Routing is LLM only, so nothing ran.`);
    const m = matchPrompt(said, prompts, { strictNumbers: Boolean(cast.castFareRule) }); // fare:
    return answer(said, source, m, `${why} Used the Scripted brain instead.`);
  };
  const preview = (turn) => { setSelectedId(turn.uc.id); startRun(turn.uc, { said: `Preview “${turn.uc.title}” here`, how: "picked", preview: true }); };
  const onHop = (turn, n) => {
    if (turn?.uc && turn.uc.id !== selectedId) setSelectedId(turn.uc.id);
    setSelHop(n ?? (turn?.result?.ok ? focusHop(turn.result.body.run) : null)); // See evidence (no hop): the run's own focus hop
    if (!["sequence", "reel"].includes(cfg.tab) || cfg.views[cfg.tab] !== "embedded") setCfg((c) => chooseTab(c, "sequence"));
    setQcOpen(false);
  };

  // Reset: the server clears this workspace's mode and runs; results, the chat, extra pages and the diagram go back to the start.
  const reset = useCallback(async () => {
    runSeq.current += 1;
    setInstrEdit(null);
    dropPick();
    setRunning(false);
    const ok = await resetWorkspace().catch(() => false);
    setResults({}); setOpened({}); setLast(null); setTurns([]); setSelHop(null); setRunCount((n) => n + 1); setModeMsg("");
    setResetSignal((n) => n + 1);
    if (viewFromHash().startsWith(EXTRA_PREFIX)) select("agent");
    await loadMode();
    if (realLevel === "full") loadSignin();
    setResetMsg(ok ? "Reset: your workspace's runs, results, the chat, extra pages and the diagram are back to the start." : "Reset failed on the server; the view was cleared anyway.");
  }, [loadMode, loadSignin, realLevel]);

  const signedIn = Boolean(signin?.signedIn);
  const afterSignIn = (body) => {
    setSignOpen(false);
    setSignin((s) => ({ ...(s || {}), signedIn: true, user: body.user }));
    setModeMsg(`Signed in with PingOne (pi.flow) as ${body.user?.name || "the demo user"}.`);
    const p = pendingRun.current; pendingRun.current = null;
    if (p?.u) startRun(p.u, p.turn, p.who);
  };
  const signOut = async () => { await postJson("/api/signout", {}).catch(() => null); pendingRun.current = null; loadSignin(); setModeMsg("Signed out."); };

  const onKeyNav = (e, i) => {
    const fwd = e.key === "ArrowDown" || e.key === "ArrowRight";
    if (!fwd && e.key !== "ArrowUp" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const next = BASE_NAV[(i + (fwd ? 1 : BASE_NAV.length - 1)) % BASE_NAV.length];
    select(next.id);
    document.getElementById(`tab-${next.id}`)?.focus();
  };

  // One neutral banner line for every page (rule 2). The hosted copy has its own, from the server; until /api/info answers, a hosted page keeps the banner the
  // server put in the HTML, so it never shows the local sentence first.
  const hosted = info?.hosted === true;
  const banner = !info ? (servedBanner || BANNER_LOCAL) : hosted ? (typeof info.hostedBanner === "string" ? info.hostedBanner : BANNER_HOSTED) : BANNER_LOCAL;
  const extraKey = current.startsWith(EXTRA_PREFIX) ? current.slice(EXTRA_PREFIX.length) : null;
  const sayNotes = (story?.talkTrack || []).filter((t) => (current === "agent" ? t.step === DEMO_GUIDE[agendaStep]?.id : (PRESENTER_TALK[extraKey ? "extra" : current] || []).includes(t.id)));
  const verticalLabel = verticalInfo?.label || vertical;
  const verticalSelect = <VerticalSelect vertical={vertical} verticals={verticals} onChange={setVertical} />;
  const lastTurn = shownTurns[shownTurns.length - 1];
  const showHandoff = Boolean(uc && isHandoff(uc) && !evRun);
  return (
    <div className="app" data-presenter={presenter ? "true" : undefined} data-text={cfg.text}>
      <button type="button" className="skip" onClick={() => document.getElementById("main")?.focus()} data-testid="skip">Skip to the main content</button>
      <header className="shell-bar">
        <div className="shell-brand">
          <span className="shell-logo" aria-hidden="true">Af</span>
          <h1 className="shell-name">Appfire Agent Governance LAB</h1>
        </div>
        {!presenter && (
          <nav className="shell-nav" aria-label="Agent areas">
            <div role="tablist" aria-orientation="horizontal" className="shell-nav__list" data-testid="nav">
              {BASE_NAV.map((n, i) => (
                <button key={n.id} id={`tab-${n.id}`} role="tab" type="button" aria-selected={current === n.id} aria-controls={current === n.id ? `panel-${n.id}` : undefined} tabIndex={current === n.id || (extraKey && i === 0) ? 0 : -1}
                  onClick={() => select(n.id)} onKeyDown={(e) => onKeyNav(e, i)} data-testid={`nav-${n.id}`}>{n.label}</button>
              ))}
            </div>
            {extraNav.length > 0 && (
              <label className="shell-more">
                <span className="sr-only">More pages</span>
                <select id="tab-more" value={extraKey ? current : ""} onChange={(e) => { if (e.target.value) select(e.target.value); }} aria-controls={extraKey ? `panel-${current}` : undefined} data-current={extraKey ? "true" : undefined} data-testid="nav-more">
                  <option value="">More ({extraNav.length})</option>
                  {extraNav.map((n) => <option key={n.id} value={n.id} data-testid={`nav-${n.id}`}>{n.label}</option>)}
                </select>
              </label>
            )}
          </nav>
        )}
        <div className="shell-right">
          <TopMenu
            theme={{ value: theme, onChange: setTheme }}
            fontSize={{ value: fontStep, onChange: setFontStep }}
            present={{ active: presenter, onToggle: () => setPresenter((v) => !v), label: "Presenter (P)" }}
            help={{ onClick: () => setGuideOpen(true), label: "Demo guide" }}
            version={info?.version || null}
            onReset={reset}
            showSignIn={mode === "live" && realLevel === "full"}
            signedIn={{ subject: signedIn ? (signin?.user?.name || "demo user") : null, onSignIn: () => setSignOpen(true), onSignOut: signOut }}
            extra={<button type="button" aria-expanded={qcOpen} aria-controls={qcOpen && current === "agent" && !page ? "quick-config" : undefined} onClick={() => { setQcOpen((v) => !v); if (page || current !== "agent") select("agent"); }} data-testid="qc-open">Quick Config</button>}
          >
            <ShelfLink url={info?.shelfUrl} headers={() => ({ "x-workspace": workspaceId() })} />
            <VerifyMark id="appfire-agent-governance-lab" headers={() => ({ "x-workspace": workspaceId() })} />
          </TopMenu>
          {/* rule 19 (2026-11-03): the conformance gate greps for a mode-real testid in the UI; this hidden marker aliases the Real button. */}
          <span hidden aria-hidden="true" data-testid="mode-real" />
          {/* The opening mode is the server's; tests and scripts read it here (no words) and switch it with POST /api/mode. */}
          <span hidden aria-hidden="true" data-testid="mode" data-mode={mode || ""} />
        </div>
      </header>
      <p className="banner" role="note" data-state={hosted ? "hosted" : "info"} data-testid="banner">{banner}</p>
      <div className="statusline">
        <span className="chip" data-testid="workspace">Workspace: {workspaceId()}</span>
        {(modeMsg || modeFailed) && <p className="notice" role="status" data-testid="mode-msg">{modeMsg || "Server did not answer."}</p>}
      </div>
      <p className="sr-only" role="status" aria-live="polite">{resetMsg}</p>
      <main className="content" id="main" tabIndex={-1}>
        <div id={`panel-${current}`} role="tabpanel" aria-labelledby={extraKey ? "tab-more" : `tab-${current}`}>
          {error && <p className="app-error" role="alert">Could not load the lab ({error}). Is the server running?</p>}
          {presenter && <AgendaSteps step={agendaStep} onStep={(i) => setAgendaStep(Math.max(0, Math.min(DEMO_GUIDE.length - 1, i)))} onRun={guideRun} onCompare={guideCompare} activeUc={guideRunning} cast={cast} prompts={prompts} />}
          {presenter && sayNotes.length > 0 && (
            <aside className="say" data-testid="presenter-say" aria-label="Talk track">
              {sayNotes.map((t) => <p key={t.id}><strong>{t.title}.</strong> {t.say}</p>)}
            </aside>
          )}
          {current === "agent" && page === "compare" && <ComparePage key={comparePreset || "first"} vertical={vertical} startPreset={comparePreset} cast={cast} prompts={prompts} onBack={() => { setComparePreset(null); select("agent"); }} />}
          {current === "agent" && page && page !== "compare" && (
            <FullPageEvidence page={page} onPage={select} onBack={() => select("agent")} catalog={catalog} selectedId={selectedId} failed={!catalog && !!error}
              onPickRun={(id) => { pick(id); const u = allUc.find((x) => x.id === id); startRun(u, null, personaFor(u) || persona); }}
              run={evRun} running={running} selHop={selHop} onSelect={setSelHop} verticalSelect={verticalSelect} />
          )}
          {current === "agent" && !page && (
            <div className="agno" data-several={several ? "true" : undefined}>
              {!presenter && (
                <Rail storageKey="aag.setup" label="Setup">
                <SetupSidebar onNewChat={() => { dropPick(); setTurns([]); setSelHop(null); }} host={mode !== "live" || (realLevel === "full" && uc?.realGate?.real === false) ? cast.castHost : null} several={several} setSeveral={setSeveral} agent={cast.castAgent}
                  vertical={vertical} verticals={verticals} onVertical={setVertical} sessions={sessions} onSession={pick}
                  brain={cfg.brain} brainInfo={brainInfo} onBrain={(b) => setCfg((c) => ({ ...c, brain: b }))}>
                  <UseCasePicker catalog={catalog} selectedId={selectedId} onPick={pick} failed={!catalog && !!error} keep={several ? isHandoff : null} />
                </SetupSidebar>
                </Rail>
              )}
              <div className="work">
                <AgentColumn agent={cast.castAgent} brand={cast.castBrand} userId={userId} vertical={vertical} verticalLabel={verticalLabel} verticals={verticals} stub={stub} prompts={prompts} turns={shownTurns}
                  status={busy ? "running" : statusOf(lastTurn)} onSay={say} onHop={onHop} onPreview={preview} running={busy}
                  person={cast.castPerson || "customer"} fare={Boolean(cast.castFareRule)} step={presenter ? DEMO_GUIDE[agendaStep] || DEMO_GUIDE[0] : null} onNextStep={() => setAgendaStep((i) => Math.max(0, Math.min(DEMO_GUIDE.length - 1, i + 1)))}
                  instructions={<AgentInstructions config={instrConfig} text={instrEdit} onText={setInstrEdit} />} />
                {qcOpen ? (
                  <QuickConfig id="quick-config" config={cfg}
                    brainInfo={brainInfo} onBrain={(b) => setCfg((c) => ({ ...c, brain: b }))} onRouting={(r) => setCfg((c) => ({ ...c, routing: r }))}
                    onView={(v, s) => setCfg((c) => setView(c, v, s))} onText={(t) => setCfg((c) => ({ ...c, text: t }))} onPresenter={setPresenter}
                    onReset={() => setCfg(cleanConfig(null))} onClose={() => { setQcOpen(false); document.querySelector('[data-testid="qc-open"]')?.focus(); }} />
                ) : (
                  <EvidenceColumn running={running} run={evRun} selHop={selHop} onSelect={setSelHop} config={cfg} onTab={(v) => setCfg((c) => chooseTab(c, v))} onFull={select}
                    vertical={vertical} resetSignal={resetSignal} lastRun={last} uc={uc} catalog={catalog} userId={userId} showHandoff={showHandoff} why={why}>
                    {uc && (
                      <details className="ucpanel" open ref={runRef} data-testid="uc-panel">
                        <summary>{uc.title}: inputs, persona, Run and the raw result</summary>
                        <RunPanel uc={uc} vertical={vertical} verticals={verticals} persona={persona} setPersona={setPersona} personas={personas} onRun={run} running={busy} result={result} mode={mode} realLevel={realLevel} />
                      </details>
                    )}
                  </EvidenceColumn>
                )}
              </div>
            </div>
          )}
          {current === "runs" && <RunHistory refresh={runCount} />}
          {current === "diagram" && <DiagramView vertical={vertical} resetSignal={resetSignal} lastRun={last} />}
          {talkOpen && story && <TalkTrack talk={story.talkTrack} onRun={talkRun} activeUc={guideRunning} onClose={() => { setTalkOpen(false); if (current === "talk") select("agent"); }} />}
          {current === "talk" && !story && <p className="muted">{error ? "The talk track could not be loaded." : "Loading..."}</p>}
          {extraKey && opened[extraKey] && <ExtraPage opens={extraKey} entry={opened[extraKey]} />}
        </div>
      </main>
      <SignInDialog isOpen={signOpen} username={signin?.username} onClose={() => { setSignOpen(false); pendingRun.current = null; }} onSignedIn={afterSignIn} />
      <DemoGuide isOpen={guideOpen} onClose={() => setGuideOpen(false)} onRun={guideRun} onCompare={(s) => { setGuideOpen(false); guideCompare(s); }} activeUc={guideRunning} catalog={catalog} cast={cast} prompts={prompts} />
      {phoneApproval && <MockPhone approval={phoneApproval} onDecided={onPhoneDecided} onClose={() => {}} approvedSentence={phoneApproval.kind !== "real" && last?.run?.fareRule ? FARE_PHONE_APPROVED : undefined} />}
    </div>
  );
}

