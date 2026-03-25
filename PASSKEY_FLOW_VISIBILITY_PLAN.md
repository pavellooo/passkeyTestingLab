# Passkey Flow Visibility Plan

## Purpose
Create a clear, end-to-end way to observe and explain passkey registration and authentication traffic for real account flows in this lab project.

This document is the working source of truth across sessions.

## Scope
We want visibility into all non-secret data moving between:
- Frontend app
- Backend server
- Browser WebAuthn APIs

We explicitly do not expose authenticator private keys or hardware-protected secrets.

## Success Criteria
- A user can run registration and authentication on a real account and see each step in sequence.
- Every request and response involved in WebAuthn flows is captured and viewable in the UI.
- Payloads can be viewed in both raw and decoded/explained form.
- Each flow can be traced end-to-end with a shared trace ID.
- Verification checks are shown individually (pass/fail + reason), not only as a final result.

## Architecture Direction
1. Frontend flow inspector panel/timeline
2. Backend trace logging for WebAuthn endpoints
3. Payload decoding and field annotations
4. Verification checkpoint reporting
5. Optional sequence diagram view

## Current Gaps To Address
- Cross-tab trace visibility is not always immediate with localStorage-only syncing.
- Export exists, but there is no import/replay screen yet for uploaded files.
- There is no dedicated full-screen diagram exploration page yet.

## Phase 2.1: Inspector Reliability Hardening
Goal: make cross-tab and page-to-page inspector behavior consistent and immediate.

Tasks:
- Add `BroadcastChannel`-based live event sync (primary) with localStorage as fallback.
- Add deterministic storage schema/versioning for event persistence.
- Ensure standalone inspector can list recent traces even when opened before new events arrive.
- Add a backend `trace index` endpoint for recent trace IDs to reduce frontend dependence on browser storage.

Definition of done:
- New traces appear in standalone inspector within 1 second while another tab is active.
- Trace list remains visible after refresh without waiting for new events.

## Phase Plan

### Phase 1: Instrumentation Foundation
Goal: capture every relevant payload and tie events together.

Tasks:
- Add flow trace ID generation at flow start (registration/authentication).
- Pass trace ID in frontend-to-backend requests.
- Add backend middleware/log hooks for:
  - Incoming body (sanitized)
  - Outgoing response body (sanitized)
  - Endpoint path + status + timestamp
- Add shared event schema used by frontend and backend logs.

Definition of done:
- One full registration attempt can be reconstructed from logs using trace ID.
- One full authentication attempt can be reconstructed from logs using trace ID.

### Phase 2: Frontend Timeline UI
Goal: visualize events in strict order.

Tasks:
- Add a "Passkey Flow Inspector" panel.
- Show timeline items with:
  - timestamp
  - event type
  - source (frontend/server)
  - trace ID
- Add expand/collapse per event.
- Add copy-to-clipboard for raw payload.

Definition of done:
- A user can watch live event progression during both flows.

### Phase 3: Raw + Decoded Views
Goal: make payloads understandable.

Tasks:
- Side-by-side event detail:
  - Raw JSON payload
  - Decoded/annotated fields
- Decode and explain at least:
  - challenge
  - clientDataJSON
  - authenticatorData summary
  - attestation/assertion key fields
  - signCount
- Highlight encoding conversions:
  - ArrayBuffer <-> base64url
  - bytes <-> JSON/CBOR representations

Definition of done:
- A learner can identify what each critical field means without external tools.


### Phase 4: Sequence Diagram Visualization
Goal: visually represent the flow of payloads between Browser, Frontend, and Backend as a sequence diagram.

Tasks:
- Add a button to the Flow Inspector page to render a sequence diagram of the current flow.
- Create a new route (e.g., `/flow-diagram` or similar) to display the diagram.
- Diagram should show:
  - Each step as a message between Browser, Frontend, and Backend lanes
  - Payloads (or summaries) as part of the diagram
  - Registration and authentication flows
- Use a diagramming library (e.g., Mermaid.js or similar) for rendering.
- Ensure routing is properly hooked up from the inspector page.

Definition of done:
- A user can view a sequence diagram of a registration or authentication flow, generated from captured events.

### Phase 5: Diagram + Export (Optional)
Goal: improve teaching and session handoff.

Tasks:
- Add 3-lane sequence diagram (Browser, Backend, Authenticator).
- Add export of flow record as JSON.
- Add export as ZIP (JSON + metadata + optional markdown summary).
- Add optional markdown/text export for documentation snapshots.

Definition of done:
- A flow can be shared as a reproducible artifact between sessions.

### Phase 6: Import + Replay Explorer (Optional)
Goal: allow uploaded exports to be restored and explored in a dedicated UI.

Tasks:
- Add `/flow-explorer` page for import/replay workflows.
- Add JSON upload parser and schema validation.
- Add ZIP upload support (extract JSON payload and metadata).
- Add readable replay view:
  - timeline list
  - filter by trace ID/step/source/status
  - raw payload viewer and decoded viewer (when available)
- Add sequence diagram mode in the same page for imported flows.

Definition of done:
- A user can upload a previously exported file and inspect it fully without rerunning the flow.

## Data Safety Rules
- Never log or display private keys (not available through WebAuthn APIs anyway).
- Sanitize or mask:
  - session tokens
  - cookies
  - account PII where unnecessary
- Use full-payload visibility only in local/dev mode.
- In non-dev modes, default to masked/truncated sensitive values.

## Event Model (Draft)
Use this shape for both backend and frontend events.

```json
{
  "traceId": "uuid-or-short-id",
  "flowType": "registration|authentication",
  "step": "string",
  "source": "frontend|backend|browser-api",
  "direction": "outbound|inbound|internal",
  "endpoint": "/api/... or browser method",
  "timestamp": "ISO-8601",
  "status": "info|ok|error",
  "payloadRaw": {},
  "payloadDecoded": {},
  "notes": ["optional explanation lines"],
  "verification": {
    "name": "optional check name",
    "result": "pass|fail|skip",
    "reason": "optional"
  }
}
```

## Initial Implementation Order
1. Backend trace ID + request/response capture
2. Frontend trace propagation + local event buffer
3. Basic timeline panel (raw payloads first)
4. Inspector reliability hardening (cross-tab sync + trace index)
5. Decoders and annotated view
6. Verification checkpoint reporting
7. Sequence diagram/export
8. Import + replay explorer (if needed)

## Working Checklist
- [x] Phase 1 complete ✅ Verified 2026-03-23
- [x] Phase 2 complete ✅ Implemented 2026-03-23
- [ ] Phase 2.1 reliability hardening
- [ ] Phase 3 complete
- [ ] Phase 4 complete
- [ ] Phase 5 complete (optional)
- [ ] Phase 6 complete (optional)

## Session Log Template
Use this section to keep continuity between chats.

### Session Entry Template
- Date:
- Goal:
- Changes made:
- Files touched:
- Decisions made:
- Open questions:
- Next step:

### Session Entry - 2026-03-23
- Date: 2026-03-23
- Goal: Implement Phase 1 instrumentation foundation and test locally.
- Changes made:
  - Added backend trace middleware for all /webauthn routes.
  - Added backend in-memory trace event store with request/response capture and sanitization.
  - Added backend endpoint to fetch a trace by traceId.
  - Added frontend traceId generation and propagation for registration/authentication flows.
  - Added frontend in-memory flow event buffer on window.__passkeyFlowEvents.
  - Fixed local development configuration: HTTP instead of HTTPS, proper CORS, correct env values.
  - Updated README and scripts for consistent local and deployed-local workflows.
  - Created Frontend/.env.example and PHASE_1_VERIFICATION.md guide.
- Files touched:
  - Backend/Server.js
  - Frontend/src/component/passkey.js
  - Frontend/.env (created)
  - Frontend/.env.example (created)
  - Backend/.env (updated to use local HTTP config)
  - README.md (updated with working local setup)
  - package.json (streamlined scripts)
  - PASSKEY_FLOW_VISIBILITY_PLAN.md
  - PHASE_1_VERIFICATION.md (created)
- Decisions made:
  - Keep Phase 1 storage in-memory first for speed.
  - Mask obvious token/cookie/authorization fields in logs.
  - Use x-passkey-trace-id header as the correlation key.
  - Use HTTP locally to avoid self-signed certificate issues.
  - Store local config in env (no hardcoded values in code).
- Verification completed:
  - ✅ window.__passkeyFlowEvents captures 8+ events per flow
  - ✅ Frontend event logging working
  - ✅ Backend trace capture working
  - ✅ CORS properly configured
  - ✅ Local development fully functional
- Next step:
  - Phase 2: Build Passkey Flow Inspector UI panel/timeline to visualize captured events

### Session Entry - 2026-03-23 (Phase 2)
- Date: 2026-03-23
- Goal: Implement Passkey Flow Inspector timeline UI in the app.
- Changes made:
  - Added a Passkey Flow Inspector panel beside the auth form.
  - Added strict-order timeline rendering with timestamps, step/event, source, and trace ID.
  - Added expand/collapse per timeline row.
  - Added copy-to-clipboard for raw payload on each expanded row.
  - Added live frontend event syncing using a custom window event.
  - Added backend trace polling for the latest trace ID and merged frontend/backend timeline view.
  - Added standalone inspector route at /flow-inspector with trace ID filtering input/chips.
- Files touched:
  - Frontend/src/component/passkey.js
  - Frontend/src/component/FlowInspectorPage.js
  - Frontend/src/App.js
  - README.md
  - PASSKEY_FLOW_VISIBILITY_PLAN.md
- Decisions made:
  - Keep Phase 2 in the existing login/register page first for rapid iteration.
  - Fetch backend events for latest active trace to keep UI responsive.
  - Use in-memory view controls (expanded rows) with no persistence yet.
- Verification completed:
  - ✅ Frontend build compiles successfully after Phase 2 changes
  - ✅ Timeline shows live flow progression
  - ✅ Expand/collapse and Copy Raw Payload are functional
- Next step:
  - Phase 3: Add decoded/annotated payload view (raw vs explained)

### Session Entry - 2026-03-23 (Planner Update)
- Date: 2026-03-23
- Goal: Align roadmap with observed inspector behavior and next feasible scope.
- Changes made:
  - Added explicit reliability hardening phase for cross-tab sync latency and trace discovery.
  - Expanded export scope to include ZIP artifact packaging.
  - Added future import/replay explorer page with upload + validation + diagram support.
- Decisions made:
  - Treat localStorage as temporary persistence, not the final synchronization mechanism.
  - Keep upload/replay and full diagram exploration as later phases after core decode/checkpoint work.
- Next step:
  - Implement Phase 2.1 reliability hardening before deepening export/import UX.

### Session Entry - 2026-03-23 (Phase 2.1)
- Date: 2026-03-23
- Goal: Improve immediate cross-tab inspector sync and reduce localStorage timing issues.
- Changes made:
  - Added BroadcastChannel (`passkey-flow-events`) sync for immediate cross-tab event propagation.
  - Kept localStorage as persistence fallback with existing TTL pruning.
  - Wired clear actions to broadcast updates so all open tabs stay in sync.
- Files touched:
  - Frontend/src/component/passkey.js
  - Frontend/src/component/FlowInspectorPage.js
  - Frontend/src/component/FlowInspectorPanel.js
- Verification completed:
  - ✅ No static errors in updated files
  - ✅ Frontend build compiles successfully
- Next step:
  - Test multi-tab behavior manually and then continue with decoder/explorer enhancements.

### Session Entry - 2026-03-24 (Phase 2 QoL)
- Date: 2026-03-24
- Goal: Improve inspector usability for real testing sessions.
- Changes made:
  - Updated standalone filter to search by email/phone/trace ID.
  - Added trace summary chips that show identity + flow type + trace ID.
  - Added identity grouping section to clarify multiple traces for one account.
  - Added `Expand All` and `Collapse All` controls for timeline events.
  - Displayed trace identity context in event rows where available.
- Files touched:
  - Frontend/src/component/FlowInspectorPage.js
  - README.md
  - PASSKEY_FLOW_VISIBILITY_PLAN.md
- Verification completed:
  - ✅ Frontend build compiles successfully after QoL patch set.

### Session Entry - 2026-03-24 (Phase 3 Start)
- Date: 2026-03-24
- Goal: Start Phase 3 and refine decoded UX so event details are understandable.
- Changes made:
  - Added decoder helpers in both inspector views to parse common WebAuthn fields.
  - Added side-by-side event details: Raw Payload and Decoded / Annotated.
  - Added decoded extraction/annotation coverage for:
    - challenge
    - clientDataJSON
    - authenticatorData summary (flags, RP ID hash, signCount)
    - assertion/attestation key field summaries
    - encoding conversion notes (base64/base64url bytes and CBOR note)
  - Hid decoded panel when events only contain identity input or no WebAuthn fields.
  - Replaced generic decoded JSON dump with human-readable field cards.
  - Added per-field "Why this matters" text and compact notes/conversion guidance.
- Files touched:
  - Frontend/src/component/FlowInspectorPanel.js
  - Frontend/src/component/FlowInspectorPage.js
  - PASSKEY_FLOW_VISIBILITY_PLAN.md
- Verification completed:
  - ✅ Frontend build compiles successfully after Phase 3 implementation and UX refinement.
- Next step:
  - Tune event-specific labels and copy so each timeline step explains expected payloads more explicitly.

## Notes
- Start with visibility before UI polish.
- Keep logs structured to avoid one-off debug prints.
- Build decode helpers once and reuse in both registration and authentication views.
