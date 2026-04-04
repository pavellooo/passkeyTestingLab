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
- Better description of the payload breakdown


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
Goal: Visualize events in strict order.

Tasks:
- Added a "Passkey Flow Inspector" panel.
- Timeline items show:
  - timestamp
  - event type
  - source (frontend/server)
  - trace ID
- Expand/collapse per event.
- Copy-to-clipboard for raw payload.
- Filtering by email/phone/trace ID.
- Identity grouping for multiple traces per account.
- "Expand All" and "Collapse All" timeline controls.
- Trace grouping by identity.
- Live event syncing (initially via BroadcastChannel + localStorage, now simplified for sequence diagram).

Definition of done:
- A user can watch live event progression during both flows.
- Timeline is filterable and events are grouped by identity.

### Phase 3: Raw + Decoded Views
Goal: Make payloads understandable.

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
- Per-field "Why this matters" text and compact notes/conversion guidance.

Definition of done:
- A learner can identify what each critical field means without external tools.
- Decoded panel is hidden when events only contain identity input or no WebAuthn fields.

### Phase 4: Sequence Diagram Visualization (Updated)
Goal: visually represent the flow of payloads across Secure Storage, Browser, Backend, and Database as a sequence diagram.

Tasks:
- Create a new route (e.g., `/flow-diagram` or similar) to display the diagram.
- Diagram page now works by uploading a JSON trace file (exported from the inspector or backend).
- Diagram shows:
  - Each step as a message between Secure Storage, Browser, Backend, and Database lanes
  - Payloads (or summaries) as part of the diagram
  - Registration and authentication flows
- Use a diagramming library (e.g., Mermaid.js or similar) for rendering.
- No real-time syncing or dropdowns—just upload and visualize.

Definition of done:
- A user can view a sequence diagram of a registration or authentication flow, generated from an uploaded trace file.

### Next Phase: Show JWT Details
Goal: Add the ability to decode and display JWT (JSON Web Token) details in the inspector and/or diagram views.

Tasks:
- Detect JWTs in payloads or responses.
- Decode JWTs and display header, payload, and signature sections.
- Show claims in a readable format.
- Highlight important claims (exp, iat, sub, aud, etc).
- Add UI for toggling raw/decoded JWT view.

Definition of done:
- A user can click on a JWT and see its decoded details in the UI.

Status update (2026-04-03):
- Implemented on the passkey login page with an explicit Show JWT Details / Hide JWT Details toggle.
- JWT examples and insecure demo mode controls are grouped inside the toggle section.
- JWT mode is propagated to backend requests via `x-insecure-demo-mode` header.


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
- [x] Phase 1 - complete ✅ Verified 2026-03-23
- [x] Phase 2 - complete ✅ Implemented 2026-03-23
- [x] Phase 3 - complete ✅ Implemented 2026-03-23
- [x] Phase 4 - complete ✅ Implemented 2026-03-27
- [x] Phase 5 - complete ✅ Implemented 2026-04-03 (login page JWT details toggle + demo mode visibility)

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



### Session Entry - 2026-03-27 (Sequence Diagram Flow View Overhaul)
- Date: 2026-03-27
- Goal: Overhaul the sequence diagram flow view for better usability and clarity.
- Changes made:
  - Added clickable buttons directly onto the Mermaid sequence diagram for event selection, removing the need for a separate table.
  - Displayed event payloads directly within the diagram for immediate context.
  - Enabled uploading of JSON files exported from the flow inspector panel to generate the sequence diagram.
  - Improved code clarity by adding explanatory comments throughout the relevant components.
- Files touched:
  - FlowSequenceDiagram.js
  - README.md
  - PASSKEY_FLOW_VISIBILITY_PLAN.md
- Decisions made:
  - Integrate all event interaction and payload visibility into the diagram itself for a more intuitive workflow.
  - Use file upload as the primary method for loading flow data into the diagram (instead of sync with BroadcastChannel)
- Verification completed:
  - ✅ Clickable overlays/buttons appear on the diagram and select events as intended.
  - ✅ Payloads are visible within the diagram.
  - ✅ JSON upload generates the correct diagram.
  - ✅ Code is now better documented with comments.
- Next step:
  - Continue with JWT detail extraction 
  - improve display/descriptions in the inspector/diagram views.