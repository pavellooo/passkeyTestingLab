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

### Phase 4: Verification Checkpoints
Goal: make server validation transparent.

Tasks:
- Report each verification check as a discrete result row:
  - Challenge match
  - Origin check
  - RP ID hash check
  - User verification requirements
  - Signature verification
  - Counter logic
- Include pass/fail and a concise reason.
- Surface failure point prominently in timeline.

Definition of done:
- Failed auth/registration clearly shows first failed checkpoint and reason.

### Phase 5: Diagram + Export (Optional)
Goal: improve teaching and session handoff.

Tasks:
- Add 3-lane sequence diagram (Browser, Backend, Authenticator).
- Add export of flow record as JSON.
- Add optional markdown/text export for documentation snapshots.

Definition of done:
- A flow can be shared as a reproducible artifact between sessions.

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
4. Decoders and annotated view
5. Verification checkpoint reporting
6. Sequence diagram/export (if needed)

## Working Checklist
- [ ] Phase 1 complete
- [ ] Phase 2 complete
- [ ] Phase 3 complete
- [ ] Phase 4 complete
- [ ] Phase 5 complete (optional)

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

## Notes
- Start with visibility before UI polish.
- Keep logs structured to avoid one-off debug prints.
- Build decode helpers once and reuse in both registration and authentication views.
