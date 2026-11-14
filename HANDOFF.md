# Handoff — Appfire Agent Governance LAB

Date: 2026-11-14 · Repo: `curtismu7/appfire-agent-governance-LAB` · Local: `~/Development/AI-DEMO-Standalone/standalone/appfire-agent-governance-LAB`
URL: the lab-proxy domain's `/appfire-agent-governance/` path, opened from the shelf card (direct: `http://127.0.0.1:7814/`) · Port 7814 · Tier: Demo
Sign-in (Real): the demo user is named by `AAG_DEMO_USERNAME` in the app `.env`; its password is held by the owner and is deliberately not recorded here · All work merged to `main`, CI + Image green at `d91a777`.

## What this lab is
Standalone Ping demo for Appfire's Agentic AI evaluation (the customer's brief): Ping governs the agent **front end** (identity, delegated privilege, per-call authorization, audit); Appfire's HIVE stays the backend brain — never called, represented only. 87 use cases in 8 tracks. **Real mode is the default** and is real-only.

## Current behavior (owner-approved)
- **Real mode runs real only**: a mock-only use case is refused with `403 mock_in_real_refused` + the fixed reason. No silent mock fallback. 11 use cases run Real (UC1, UC3, UC4, UC6, UC7, UC8, UC17, UC19, UC20, UC24, UC28); 76 blocked, each with its reason.
- New workspaces default to Real (`AAG_LAB_MODE=live` in the app `.env`; documented in `.env.example`).
- UI: names only (no UC# labels) in the Demo guide, help lists and talk track. Colored JSON viewer with **Formatted | Raw** toggle. Sign-in modal has sticky always-visible buttons. Composer stands out (accent border) and a prompt chip fills it, flashes, then sends (260 ms).
- **Talk track floats over every tab, non-modal** (no backdrop), with Pop out for a second monitor; persists until closed.
- **Demo guide** (help button): 8 steps mapped to the brief + "Real mode: what runs, what is blocked" (11 real with Run links, 76 blocked with reasons), built from the same catalog as the gate.
- Talk track has per-step Run links (12 use cases wired); running one switches to the Agent column.

## Real wiring facts (hard-won, don't relearn)
- Agent actor app: reused the "AI Agent - demoUser" app (CLIENT_SECRET_POST; its client id is `AAG_AGENT_CLIENT_ID` in the app `.env`). The lab's own agent id is NOT in P1AZ's 42-id actor list.
- Sign-in asks **agent scope only** (PingOne refuses two custom resources in one authorize). `act` may arrive as a JSON string (`actOf` parses it).
- SE gateway ingress needed `proxy-buffer-size: 64k` (huge `x-gw-audit-trail` header caused 502 on the second tools/call).
- SE `hitl-service` scaled 0→1; its ingress applied (host name in `.env.example`); lab `.env` has `AAG_HITL_SERVICE_URL` / `AAG_HITL_INTERNAL_SECRET` (write-only; the server records approvals, fail-closed).
- **Open blocker (P1AZ console, owner)**: the tenant's P1AZ policy denies `create_transfer` with "No User Consent" instead of minting an INDETERMINATE/HITL challenge (the consent rule keys on a trusted-caller attribute). Until that policy flip, Real HITL challenge→phone→receipt can't fire end-to-end; Mock mode demos the full loop and the Real plumbing is live and waiting.

## Key files
- `server/src/approval.js` — reusable approval service (mock + real HITL paths); `/api/approval/*` in `app.js`
- `server/src/realGate.js` — the Real/blocked gate (fixed reasons per use case)
- `server/src/data.js` — talk track, banners, labels (`npm run talk-track` + `npm run content-pack` after edits)
- `web/src/components/MockPhone.jsx`, `TalkTrack.jsx` (FloatingDialog, noBackdrop), `DemoGuide.jsx`, `Bits.jsx` (Json viewer)
- `scripts/e2e.mjs` — 559 checks; `oneRow` clusters shell-bar tops within 8 px

## Verification commands
- `./run-tests.sh unit` or `npm test` (server 261, web 196, scripts 81)
- `E2E_PORT=7831 npm run e2e` → 559 checks (uses its own servers/ports; never against the Docker container)
- `node ~/Development/demo-kit-base/scripts/conformance.mjs .` → 0 failed (rule 18 MODE-switch WARN is advisory, SE k8s deferred)
- Rebuild: `HOST_PORT=7814 docker compose up -d --build --force-recreate`

## Gotchas hit this session
- `npm test` full runs flaked under load (leftover servers on e2e ports 7825-7827); always `pkill` stray `node server/src/index.js` before suites. Individual suites pass.
- The lab's vendored TopMenu is deliberately adapted (help-as-button with label, Real tooltip shown also when available). A canonical re-vendor silently reverted it once — the e2e option-title checks are the canary. Upstreaming the adaptation to `AI-DEMO-Standalone/shared/top-menu` is a pending family task (would require re-pinning ~80 labs).
- CI e2e can differ from local at 1600px — check the FAIL lines, don't assume flake.
- UI-pattern checker: 7 pages show advisory DRIFT (P3/P9/P10/C1) — family-wide for shell-based labs, 0 enforced.
- Meta-repo has unrelated uncommitted changes (`check-top-menu.sh`, `pingone-setup.sh`, `a2a-lab-LAB` pin) from another session — do not commit them with appfire work.
- Rules in force: `curtismu7` GitHub account only; no AI attribution anywhere; OrbStack not Docker Desktop; URL via lab-proxy domain, never loopback.

## Suggested next steps
1. Owner: flip the P1AZ consent rule to mint HITL challenges for `create_transfer`, then re-test the Real loop: UC8 → 428 challenge → phone → `POST /api/approval/decide` → retry with `approvalId` → REAL_PERMIT.
2. Upstream TopMenu adaptations to shared canonical + family re-pin.
3. Optional: demo-rollout pass (shelf entry already exists) for colleague distribution.
