// FlowSequenceDiagram.js — Passkey Flow Visualizer (complete rewrite)
// Renders a fully interactive SVG sequence diagram from passkey flow JSON exports.
// Every arrow is click-selectable; the right panel shows rich contextual detail.

import React, { useEffect, useRef, useState, useCallback } from 'react';

// ─── Palette & tokens (light theme) ───────────────────────────────────────────
const T = {
  bg:        '#f6f8fa',
  surface:   '#ffffff',
  surfaceAlt:'#f0f2f5',
  border:    '#d0d7de',
  borderFaint:'#e8eaed',
  text:      '#1f2328',
  textMuted: '#57606a',
  textFaint: '#afb8c1',
  accent:    '#0969da',
  accentDim: '#dbeafe',
  green:     '#1a7f37',
  greenDim:  '#dcfce7',
  yellow:    '#9a6700',
  yellowDim: '#fef9c3',
  red:       '#cf222e',
  redDim:    '#ffeef0',
  purple:    '#8250df',
  purpleDim: '#f3e8ff',
  orange:    '#bc4c00',
  orangeDim: '#fff1e5',

  // Lane colors (light tints per actor)
  laneSecure:  '#eff6ff',
  laneBrowser: '#f0fdf4',
  laneBackend: '#fffbeb',
  laneDb:      '#faf5ff',

  // Actor header colors
  actorSecure:  '#bfdbfe',
  actorBrowser: '#bbf7d0',
  actorBackend: '#fde68a',
  actorDb:      '#e9d5ff',

  // Arrow colors by category
  arrowHttp:    '#0969da',
  arrowWebAuthn:'#1a7f37',
  arrowDb:      '#8250df',
  arrowInternal:'#57606a',
  arrowCrypto:  '#bc4c00',
};

// ─── Actors ────────────────────────────────────────────────────────────────────
const ACTORS = ['SecureStorage', 'Browser', 'Backend', 'Database'];

const ACTOR_META = {
  SecureStorage: {
    label: 'Platform Secure Storage',
    sublabel: 'TPM / Secure Enclave',
    icon: '🔐',
    color: T.actorSecure,
    laneColor: T.laneSecure,
    textColor: '#1d4ed8',
    borderColor: '#93c5fd',
  },
  Browser: {
    label: 'Browser',
    sublabel: 'WebAuthn API',
    icon: '🌐',
    color: T.actorBrowser,
    laneColor: T.laneBrowser,
    textColor: '#15803d',
    borderColor: '#86efac',
  },
  Backend: {
    label: 'Backend Server',
    sublabel: 'Node.js / Express',
    icon: '⚙️',
    color: T.actorBackend,
    laneColor: T.laneBackend,
    textColor: '#92400e',
    borderColor: '#fcd34d',
  },
  Database: {
    label: 'Database',
    sublabel: 'MySQL / Storage',
    icon: '🗄️',
    color: T.actorDb,
    laneColor: T.laneDb,
    textColor: '#6b21a8',
    borderColor: '#c4b5fd',
  },
};

// ─── Synthetic event templates ─────────────────────────────────────────────────
// These fill in the "missing" arrows the raw JSON doesn't capture:
// • Browser → SecureStorage  (challenge / create request)
// • SecureStorage → Browser  (credential / assertion)
// • Backend → Database       (DB reads/writes)
// • Database → Backend       (DB responses)

function buildSyntheticEvents(rawEvents, flowType) {
  const synthetic = [];
  const hasCapturedDbTrace = rawEvents.some((event) => {
    const step = String(event?.step || '').toLowerCase();
    return step.startsWith('db.query.') || step.startsWith('db.result.');
  });
    const hasCapturedJwtIssued = rawEvents.some((event) => {
      const step = String(event?.step || '').toLowerCase();
      return step === 'authentication.jwt.issued';
    });

  rawEvents.forEach((ev) => {
    const step = (ev.step || '').toLowerCase();
    const p = ev.payloadRaw || {};

    // ── Registration: browser calls navigator.credentials.create ─────────────
    if (step === 'registration.options.received') {
      synthetic.push({
        _synthetic: true,
        _id: `syn-create-req-${ev.uiId}`,
        timestamp: ev.timestamp,
        source: 'frontend',
        direction: 'internal',
        step: 'authenticator.create.request',
        endpoint: 'navigator.credentials.create()',
        from: 'Browser',
        to: 'SecureStorage',
        label: 'navigator.credentials.create()',
        sublabel: 'challenge + pubKeyCredParams + rp + user + authenticatorSelection',
        arrowStyle: 'webauthn',
        payloadRaw: {
          type: 'PublicKeyCredentialCreationOptions',
          challenge: p.challenge,
          rp: p.rp,
          user: p.user,
          pubKeyCredParams: p.pubKeyCredParams,
          authenticatorSelection: p.authenticatorSelection,
          attestation: p.attestation,
        },
        summaryAnnotations: [
          {
            type: 'info',
            label: 'WebAuthn API invoked',
            detail: 'The browser calls navigator.credentials.create() with the server\'s options. This triggers an OS-level prompt (fingerprint, Face ID, PIN) asking the user to authorize key creation.',
          },
          {
            type: 'info',
            label: 'Bound to origin',
            detail: `The new passkey will be cryptographically bound to "${p.rp?.id || 'this site'}". It cannot be used on any other domain — this is the core anti-phishing guarantee.`,
          },
          {
            type: 'info',
            label: 'User verification required',
            detail: `authenticatorSelection.userVerification = "${p.authenticatorSelection?.userVerification || 'required'}". The device must confirm the user is physically present (biometric or PIN).`,
          },
        ],
      });
    }

    // ── Registration: secure storage returns new credential ──────────────────
    if (step === 'browser.create.completed') {
      synthetic.push({
        _synthetic: true,
        _id: `syn-create-resp-${ev.uiId}`,
        timestamp: ev.timestamp,
        source: 'frontend',
        direction: 'internal',
        step: 'authenticator.create.response',
        endpoint: 'PublicKeyCredential returned',
        from: 'SecureStorage',
        to: 'Browser',
        label: 'New credential returned',
        sublabel: `id: ${p.id || '…'} · attestationObject + publicKey`,
        arrowStyle: 'webauthn',
        payloadRaw: {
          credentialId: p.id,
          type: p.type || 'public-key',
          hasResponse: p.hasResponse,
          note: 'attestationObject, authenticatorData, clientDataJSON, publicKey present in full credential object',
        },
        summaryAnnotations: [
          {
            type: 'success',
            label: 'Key pair generated',
            detail: 'The secure enclave generated a fresh EC P-256 key pair. The private key is stored inside hardware and will never leave the device.',
          },
          {
            type: 'info',
            label: 'Attestation produced',
            detail: 'The authenticator produced an attestationObject containing the new public key, authenticatorData (flags + counter + rpIdHash), and an attestation statement.',
          },
          {
            type: 'info',
            label: 'Counter initialized',
            detail: 'A sign-count starting at 0 is embedded in authenticatorData. On every future login this counter increments, helping the server detect cloned credentials.',
          },
        ],
      });
    }

    // ── Authentication: browser calls navigator.credentials.get ──────────────
    if (step === 'authentication.options.received') {
      const creds = p.allowCredentials || [];
      synthetic.push({
        _synthetic: true,
        _id: `syn-get-req-${ev.uiId}`,
        timestamp: ev.timestamp,
        source: 'frontend',
        direction: 'internal',
        step: 'authenticator.get.request',
        endpoint: 'navigator.credentials.get()',
        from: 'Browser',
        to: 'SecureStorage',
        label: 'navigator.credentials.get()',
        sublabel: `challenge + ${creds.length} allowed credential${creds.length !== 1 ? 's' : ''} · userVerification: ${p.userVerification || 'required'}`,
        arrowStyle: 'webauthn',
        payloadRaw: {
          type: 'PublicKeyCredentialRequestOptions',
          challenge: p.challenge,
          allowCredentials: p.allowCredentials,
          userVerification: p.userVerification,
          timeout: p.timeout,
        },
        summaryAnnotations: [
          {
            type: 'info',
            label: 'Assertion requested',
            detail: `The browser forwards the server challenge and ${creds.length} allowed credential ID${creds.length !== 1 ? 's' : ''} to the platform authenticator. The OS shows a sign-in prompt.`,
          },
          {
            type: 'info',
            label: 'Challenge forwarded',
            detail: 'The nonce from the server is embedded in clientDataJSON and will be signed. This proves the response is fresh and cannot be replayed.',
          },
        ],
      });
    }

    // browser.get.completed already represents the assertion return in captured traces.

    // ── Registration: backend looks up / creates user in DB ──────────────────
    if (!hasCapturedDbTrace && step === 'registration.start' && ev.source === 'backend') {
      synthetic.push({
        _synthetic: true,
        _id: `syn-db-lookup-reg-${ev.uiId}`,
        timestamp: ev.timestamp,
        source: 'backend',
        direction: 'internal',
        step: 'db.query.users.lookupOrCreate',
        endpoint: 'DB: SELECT / INSERT users',
        from: 'Backend',
        to: 'Database',
        label: 'SELECT user by email',
        sublabel: 'Look up account · create if new · generate userId',
        arrowStyle: 'db',
        payloadRaw: {
          email: p.email,
          operation: 'select',
        },
        summaryAnnotations: [
          {
            type: 'info',
            label: 'Account lookup',
            detail: 'The server queries the database for an existing account with this email. If none exists a new row is inserted. The userId becomes the opaque userHandle stored in the passkey.',
          },
        ],
      });

      synthetic.push({
        _synthetic: true,
        _id: `syn-db-lookup-reg-resp-${ev.uiId}`,
        timestamp: ev.timestamp,
        source: 'backend',
        direction: 'internal',
        step: 'db.result.users.lookupOrCreate',
        endpoint: 'DB: users result',
        from: 'Database',
        to: 'Backend',
        label: 'User record returned',
        sublabel: 'userId · existing credentials list',
        arrowStyle: 'db',
        payloadRaw: {
          ok: true,
          rowCount: 1,
          error: null,
        },
        summaryAnnotations: [
          {
            type: 'info',
            label: 'Challenge stored',
            detail: 'The server will now generate a random challenge, store it in the database against this user, and return it in the registration options.',
          },
        ],
      });
    }

    // ── Registration: backend stores challenge before returning options ───────
    if (!hasCapturedDbTrace && step === 'http.response' && ev.source === 'backend' && ev.endpoint === '/webauthn/register') {
      synthetic.push({
        _synthetic: true,
        _id: `syn-db-store-challenge-reg-${ev.uiId}`,
        timestamp: ev.timestamp,
        source: 'backend',
        direction: 'internal',
        step: 'db.query.users.storeChallenge',
        endpoint: 'DB: UPDATE users SET challenge',
        from: 'Backend',
        to: 'Database',
        label: 'Store registration challenge',
        sublabel: `UPDATE users SET challenge = "…" WHERE email = "${p.user?.name || ''}"`,
        arrowStyle: 'db',
        payloadRaw: {
          email: p.user?.name || p.email || null,
          operation: 'update',
        },
        summaryAnnotations: [
          {
            type: 'info',
            label: 'Challenge persisted',
            detail: 'The one-time challenge is written to the database now. During /register/complete the server will read it back, compare it to what the authenticator signed, and then delete it.',
          },
        ],
      });
    }

    // ── Registration complete: backend reads challenge + verifies ─────────────
    if (!hasCapturedDbTrace && step === 'registration.complete.received' && ev.source === 'backend') {
      synthetic.push({
        _synthetic: true,
        _id: `syn-db-read-challenge-reg-${ev.uiId}`,
        timestamp: ev.timestamp,
        source: 'backend',
        direction: 'internal',
        step: 'db.query.users.readChallengeForVerify',
        endpoint: 'DB: SELECT challenge FROM users',
        from: 'Backend',
        to: 'Database',
        label: 'Fetch stored challenge',
        sublabel: `SELECT challenge WHERE email = "${p.email}"`,
        arrowStyle: 'db',
        payloadRaw: {
          email: p.email,
          operation: 'select',
        },
        summaryAnnotations: [
          {
            type: 'info',
            label: 'Challenge retrieved',
            detail: 'The server fetches the challenge it stored earlier. It will compare this against the challenge embedded in clientDataJSON that the authenticator signed.',
          },
        ],
      });

      synthetic.push({
        _synthetic: true,
        _id: `syn-db-read-challenge-reg-resp-${ev.uiId}`,
        timestamp: ev.timestamp,
        source: 'backend',
        direction: 'internal',
        step: 'db.result.users.readChallengeForVerify',
        endpoint: 'DB: challenge result',
        from: 'Database',
        to: 'Backend',
        label: 'Challenge row returned',
        sublabel: 'challenge · user_id · existing credential list',
        arrowStyle: 'db',
        payloadRaw: { ok: true, rowCount: 1, error: null },
        summaryAnnotations: [
          {
            type: 'info',
            label: 'Ready to verify',
            detail: 'With the stored challenge in hand the server invokes @simplewebauthn/server verifyRegistrationResponse() to validate the attestationObject, publicKey, and origin.',
          },
        ],
      });
    }

    // ── Registration complete: store credential ───────────────────────────────
    if (!hasCapturedDbTrace && step === 'registration.verify.result' && ev.source === 'backend' && p.verified) {
      synthetic.push({
        _synthetic: true,
        _id: `syn-db-store-cred-${ev.uiId}`,
        timestamp: ev.timestamp,
        source: 'backend',
        direction: 'internal',
        step: 'db.query.credentials.insert',
        endpoint: 'DB: INSERT credentials',
        from: 'Backend',
        to: 'Database',
        label: 'Persist new credential',
        sublabel: 'INSERT INTO credentials (credentialId, publicKey, counter, transports)',
        arrowStyle: 'db',
        payloadRaw: {
          email: p.email || null,
          operation: 'insert',
        },
        summaryAnnotations: [
          {
            type: 'success',
            label: 'Public key stored',
            detail: 'Only the public key is stored — never the private key. On future logins the server uses this public key to verify the cryptographic signature the device produces.',
          },
          {
            type: 'info',
            label: 'Counter initialized',
            detail: 'The counter is set to 0. Each authentication will update this value, enabling the server to detect if the passkey was cloned to another device.',
          },
        ],
      });

      synthetic.push({
        _synthetic: true,
        _id: `syn-db-store-cred-resp-${ev.uiId}`,
        timestamp: ev.timestamp,
        source: 'backend',
        direction: 'internal',
        step: 'db.result.credentials.insert',
        endpoint: 'DB: INSERT confirmed',
        from: 'Database',
        to: 'Backend',
        label: 'Credential saved ✓',
        sublabel: 'INSERT OK · challenge cleared from users table',
        arrowStyle: 'db',
        payloadRaw: { ok: true, credentialId: p.credentialId || null, error: null },
        summaryAnnotations: [
          {
            type: 'success',
            label: 'Registration complete',
            detail: 'The credential is now permanently stored. The one-time challenge is cleared from the users table. The server returns { success: true } to the browser.',
          },
        ],
      });
    }

    // ── Authentication: backend reads user + credentials ──────────────────────
    if (!hasCapturedDbTrace && step === 'authentication.start' && ev.source === 'backend') {
      synthetic.push({
        _synthetic: true,
        _id: `syn-db-lookup-auth-${ev.uiId}`,
        timestamp: ev.timestamp,
        source: 'backend',
        direction: 'internal',
        step: 'db.query.credentials.listForUser',
        endpoint: 'DB: SELECT credentials',
        from: 'Backend',
        to: 'Database',
        label: 'Fetch user credentials',
        sublabel: `SELECT * FROM credentials JOIN users WHERE email = "${p.email}"`,
        arrowStyle: 'db',
        payloadRaw: {
          email: p.email,
          operation: 'select',
        },
        summaryAnnotations: [
          {
            type: 'info',
            label: 'Credential list fetched',
            detail: 'The server looks up every passkey registered to this email. Each one (credentialId + transports) goes into the allowCredentials array returned to the browser.',
          },
        ],
      });

      synthetic.push({
        _synthetic: true,
        _id: `syn-db-lookup-auth-resp-${ev.uiId}`,
        timestamp: ev.timestamp,
        source: 'backend',
        direction: 'internal',
        step: 'db.result.credentials.listForUser',
        endpoint: 'DB: credentials result',
        from: 'Database',
        to: 'Backend',
        label: 'Credential rows returned',
        sublabel: 'credentialId · transports · publicKey · counter',
        arrowStyle: 'db',
        payloadRaw: {
          ok: true,
          rowCount: Array.isArray(p.allowCredentials) ? p.allowCredentials.length : 1,
          error: null,
        },
        summaryAnnotations: [
          {
            type: 'info',
            label: 'Ready to issue challenge',
            detail: 'With the credential list the server generates a fresh random challenge, stores it, and returns the authentication options.',
          },
        ],
      });
    }

    // ── Authentication: store challenge ───────────────────────────────────────
    if (!hasCapturedDbTrace && step === 'http.response' && ev.source === 'backend' && ev.endpoint === '/webauthn/authenticate') {
      synthetic.push({
        _synthetic: true,
        _id: `syn-db-store-challenge-auth-${ev.uiId}`,
        timestamp: ev.timestamp,
        source: 'backend',
        direction: 'internal',
        step: 'db.query.users.storeChallengeAuth',
        endpoint: 'DB: UPDATE users SET challenge (auth)',
        from: 'Backend',
        to: 'Database',
        label: 'Store auth challenge',
        sublabel: `UPDATE users SET challenge = "…" WHERE email = "${p.allowCredentials?.[0]?.id || '?'}"`,
        arrowStyle: 'db',
        payloadRaw: {
          email: p.email || null,
          operation: 'update',
        },
        summaryAnnotations: [
          {
            type: 'info',
            label: 'Challenge persisted',
            detail: 'Storing the challenge server-side prevents replay attacks. The authenticator will sign it; the server will compare the signed value against this stored copy.',
          },
        ],
      });
    }

    // ── Authentication complete: read challenge + publicKey ───────────────────
    if (!hasCapturedDbTrace && step === 'authentication.complete.received' && ev.source === 'backend') {
      synthetic.push({
        _synthetic: true,
        _id: `syn-db-read-auth-${ev.uiId}`,
        timestamp: ev.timestamp,
        source: 'backend',
        direction: 'internal',
        step: 'db.query.users.readForAuthVerify',
        endpoint: 'DB: SELECT challenge + credential',
        from: 'Backend',
        to: 'Database',
        label: 'Fetch challenge & public key',
        sublabel: `SELECT challenge, public_key, counter WHERE email = "${p.email}"`,
        arrowStyle: 'db',
        payloadRaw: {
          email: p.email,
          operation: 'select',
        },
        summaryAnnotations: [
          {
            type: 'info',
            label: 'Data fetched for verify',
            detail: 'The server needs the stored challenge (to compare with clientDataJSON), the stored public key (to verify the signature), and the stored counter (to check for cloning).',
          },
        ],
      });

      synthetic.push({
        _synthetic: true,
        _id: `syn-db-read-auth-resp-${ev.uiId}`,
        timestamp: ev.timestamp,
        source: 'backend',
        direction: 'internal',
        step: 'db.result.users.readForAuthVerify',
        endpoint: 'DB: verify data returned',
        from: 'Database',
        to: 'Backend',
        label: 'Challenge + public key returned',
        sublabel: 'challenge · public_key (COSE) · counter',
        arrowStyle: 'db',
        payloadRaw: { ok: true, rowCount: 1, error: null },
        summaryAnnotations: [
          {
            type: 'info',
            label: 'Verification inputs ready',
            detail: 'Now calling @simplewebauthn/server verifyAuthenticationResponse() with the assertion, stored public key, stored challenge, and stored counter.',
          },
        ],
      });
    }

    // ── Authentication: update counter after verify ───────────────────────────
    if (!hasCapturedDbTrace && step === 'authentication.verify.result' && ev.source === 'backend') {
      synthetic.push({
        _synthetic: true,
        _id: `syn-db-update-counter-${ev.uiId}`,
        timestamp: ev.timestamp,
        source: 'backend',
        direction: 'internal',
        step: 'db.query.users.updateCounterAndClearChallenge',
        endpoint: 'DB: UPDATE counter + clear challenge',
        from: 'Backend',
        to: 'Database',
        label: 'Update counter · clear challenge',
        sublabel: `SET counter = ${p.nextCounter ?? '?'}, challenge = NULL`,
        arrowStyle: 'db',
        payloadRaw: {
          email: p.email || null,
          operation: 'update',
          storedCounter: p.storedCounter,
          reportedCounter: p.reportedCounter,
          nextCounter: p.nextCounter,
          counterDidRegress: p.counterDidRegress,
        },
        summaryAnnotations: [
          {
            type: p.counterDidRegress ? 'warning' : 'success',
            label: p.counterDidRegress ? 'Counter regression — preserved stored value' : 'Counter advanced',
            detail: p.counterDidRegress
              ? `Reported counter (${p.reportedCounter}) < stored (${p.storedCounter}). Server preserves the higher value. Possible credential clone.`
              : `Counter updated from ${p.storedCounter} → ${p.nextCounter}. One-time challenge cleared to prevent replay.`,
          },
        ],
      });

      synthetic.push({
        _synthetic: true,
        _id: `syn-db-update-counter-resp-${ev.uiId}`,
        timestamp: ev.timestamp,
        source: 'backend',
        direction: 'internal',
        step: 'db.result.users.updateCounterAndClearChallenge',
        endpoint: 'DB: UPDATE confirmed',
        from: 'Database',
        to: 'Backend',
        label: 'Update confirmed ✓',
        sublabel: 'affectedRows: 1',
        arrowStyle: 'db',
        payloadRaw: { ok: true, email: p.email || null, nextCounter: p.nextCounter, error: null },
        summaryAnnotations: [
          {
            type: 'success',
            label: 'DB write complete',
            detail: 'Counter and challenge persisted. Server now generates JWT tokens.',
          },
        ],
      });

      // ── Authentication complete: JWT generation and issuance (always happens) ────
      synthetic.push({
        _synthetic: true,
        _id: `syn-jwt-issued-${ev.uiId}`,
        timestamp: ev.timestamp,
        source: 'backend',
        direction: 'outbound',
        step: 'authentication.jwt.issued',
        endpoint: '/webauthn/authenticate/complete',
        from: 'Backend',
        to: 'Browser',
        label: 'Issue JWT tokens',
        sublabel: 'accessToken (15m) + refreshToken (24h) · httpOnly Secure SameSite cookies',
        arrowStyle: 'http',
        payloadRaw: {
          jwtMode: p.jwtMode || 'standard',
          tokens: {
            accessToken: {
              type: 'JWT (RS256)',
              expiresIn: '15 minutes',
              claims: ['email', 'userId'],
              storage: 'httpOnly cookie'
            },
            refreshToken: {
              type: 'JWT (RS256)',
              expiresIn: '24 hours',
              claims: ['email', 'userId'],
              storage: 'httpOnly cookie'
            }
          },
          cookieAttributes: {
            httpOnly: true,
            secure: true,
            sameSite: 'Strict',
            path: '/',
            maxAge: '15m (access) / 24h (refresh)'
          },
          demoModeIncludesBody: p.insecureDemoMode === true
        },
        summaryAnnotations: [
          {
            type: 'success',
            label: 'Tokens issued',
            detail: 'Server generated access token (15m) and refresh token (24h) using RS256 algorithm with private key.'
          },
          {
            type: 'info',
            label: 'XSS Protection: httpOnly Cookies',
            detail: 'Tokens stored in httpOnly cookies. JavaScript on this page CANNOT read them via document.cookie or JS APIs — this prevents token theft if malicious code is injected (XSS). Only the browser\'s HTTP layer sends cookies automatically with requests.'
          },
          {
            type: 'info',
            label: 'CSRF Protection: SameSite=Strict',
            detail: 'SameSite=Strict prevents cross-site requests from sending cookies. Even if an attacker tricks you into visiting their site, the browser will not send your authentication cookies to their requests.'
          },
          {
            type: 'info',
            label: 'Transport Security: Secure flag',
            detail: 'Secure flag means the cookie is only sent over HTTPS, never HTTP. Prevents interception by network attackers.'
          },
          {
            type: p.insecureDemoMode ? 'warning' : 'success',
            label: p.insecureDemoMode ? 'Demo Mode: Tokens also in response body' : 'Production Mode: Secure-only',
            detail: p.insecureDemoMode
              ? 'For testing visibility, tokens are ALSO included in JSON response body. In production, this would be disabled — only the httpOnly cookies would carry authentication.'
              : 'Tokens are only in httpOnly cookies. Browser has no access to them, preventing XSS token theft.'
          }
        ],
      });
    }

    // ── Authentication complete: HTTP response ──────────────────────────────────
    if (!hasCapturedJwtIssued && step === 'authentication.complete.received' && ev.source === 'backend') {
      // Capture the http.response that will have { success: true } (and optionally tokens in demo mode)
      // This pairs with the JWT issued synthetic event above.
    }
  });

  return synthetic;
}

// ─── Merge raw + synthetic events into a single timeline ─────────────────────
function mergeAndSortEvents(rawEvents, syntheticEvents) {
  const eventSortPriority = (event) => {
    const step = String(event?.step || '').toLowerCase();
    if (step === 'http.request') return 0;
    if (step.endsWith('.start')) return 1;
    if (step.endsWith('.complete.received')) return 2;
    if (step.startsWith('db.query.')) return 3;
    if (step.startsWith('db.result.')) return 4;
    if (step.endsWith('.verify.result')) return 5;
    if (step === 'authentication.jwt.issued') return 6;
    if (step === 'http.response') return 7;
    return 8;
  };
  // Build a map: after which raw event should each synthetic appear?
  // Strategy: synthetic events are keyed to the raw event they follow.
  // We insert them right after their parent.

  const result = [];
  const synByParentId = {};
  syntheticEvents.forEach((s) => {
    // The uiId of the raw parent is embedded in the synthetic _id
    const match = s._id.match(/-([^-]+)$/);
    const key = s._id; // unique, insert after step match
    if (!synByParentId[s.step]) synByParentId[s.step] = [];
    synByParentId[s.step].push(s);
  });

  // Just sort everything by timestamp and handle "ties" by preferring raw→synthetic order
  const combined = [
    ...rawEvents.map((e) => ({ ...e, _synthetic: false })),
    ...syntheticEvents,
  ].sort((a, b) => {
    const ta = Date.parse(a.timestamp || '') || 0;
    const tb = Date.parse(b.timestamp || '') || 0;
    if (ta !== tb) return ta - tb;

    // Keep captured events before inferred synthetic events at same timestamp.
    if (a._synthetic !== b._synthetic) return a._synthetic ? 1 : -1;

    // For same timestamp + same capture type, enforce protocol order.
    const pa = eventSortPriority(a);
    const pb = eventSortPriority(b);
    if (pa !== pb) return pa - pb;

    return 0;
  });

  // Remove duplicate backend internal events that mirror frontend start events
  const seenStepSources = new Set();
  const filtered = combined.filter((ev) => {
    const key = `${ev.source}-${ev.direction}-${ev.step}`;
    if (
      ev.source === 'backend' &&
      ev.direction === 'internal' &&
      (ev.step || '').endsWith('.start') &&
      !ev._synthetic
    ) {
      if (seenStepSources.has(ev.step + '-frontend')) return false;
    }
    if (ev.source === 'frontend' && ev.direction === 'internal' && (ev.step || '').endsWith('.start')) {
      seenStepSources.add(ev.step + '-frontend');
    }
    return true;
  });

  // Mark frontend inbound events that are simply the client-side receipt of an already-captured backend http.response.
  const backendHttpResponses = filtered
    .filter((ev) => !ev._synthetic && ev.source === 'backend' && ev.direction === 'outbound' && ev.step === 'http.response' && ev.endpoint)
    .map((ev) => ({
      endpoint: ev.endpoint,
      ts: Date.parse(ev.timestamp || '') || 0,
    }));

  return filtered.map((ev) => {
    if (ev._synthetic) return ev;
    if (!(ev.source === 'frontend' && ev.direction === 'inbound' && ev.endpoint)) return ev;

    const ts = Date.parse(ev.timestamp || '') || 0;
    const mirrored = backendHttpResponses.some((resp) => resp.endpoint === ev.endpoint && Math.abs(resp.ts - ts) <= 2000);
    return mirrored ? { ...ev, _mirroredHttpResponse: true } : ev;
  });
}

// ─── Determine from/to for raw events ────────────────────────────────────────
function routeRawEvent(ev) {
  if (ev.from && ev.to) return { from: ev.from, to: ev.to };
  if (ev._mirroredHttpResponse) return { from: 'Browser', to: 'Browser' };

  const step = (ev.step || '').toLowerCase();
  const direction = (ev.direction || '').toLowerCase();
  const source = (ev.source || '').toLowerCase();
  const endpoint = (ev.endpoint || '').toLowerCase();

  if (step.startsWith('browser.') || endpoint.startsWith('navigator.credentials.')) {
    return step.endsWith('.completed')
      ? { from: 'SecureStorage', to: 'Browser' }
      : { from: 'Browser', to: 'SecureStorage' };
  }
  if (step.startsWith('db.query.')) return { from: 'Backend', to: 'Database' };
  if (step.startsWith('db.result.')) return { from: 'Database', to: 'Backend' };

  if (source === 'backend' && direction === 'inbound') return { from: 'Browser', to: 'Backend' };
  if (source === 'backend' && direction === 'outbound') return { from: 'Backend', to: 'Browser' };
  if (source === 'frontend' && direction === 'outbound') return { from: 'Browser', to: 'Backend' };
  if (source === 'frontend' && direction === 'inbound') return { from: 'Backend', to: 'Browser' };
  if (source === 'backend' && direction === 'internal') {
    return { from: 'Backend', to: 'Backend' }; // will be visually styled as a note
  }
  if (source === 'frontend' && direction === 'internal') return { from: 'Browser', to: 'Browser' };
  return { from: 'Browser', to: 'Backend' };
}

// ─── Arrow style inference ────────────────────────────────────────────────────
function inferArrowStyle(ev) {
  if (ev.arrowStyle) return ev.arrowStyle;
  if (ev._mirroredHttpResponse) return 'internal';
  const step = (ev.step || '').toLowerCase();
  if (step.startsWith('db.')) return 'db';
  if (step.startsWith('browser.') || step.startsWith('authenticator.') || (ev.endpoint || '').startsWith('navigator.')) return 'webauthn';
  if ((ev.endpoint || '').startsWith('/webauthn/')) return 'http';
  return 'internal';
}

// ─── Arrow color map ──────────────────────────────────────────────────────────
const ARROW_COLORS = {
  http:     T.arrowHttp,
  webauthn: T.arrowWebAuthn,
  db:       T.arrowDb,
  internal: T.arrowInternal,
  crypto:   T.arrowCrypto,
};

// ─── Build human label for arrow ─────────────────────────────────────────────
function buildLabel(ev) {
  if (ev.label) return ev.label;
  const step = ev.step || ev.endpoint || ev.type || 'event';
  return step;
}

function buildSublabel(ev) {
  if (ev.sublabel) return ev.sublabel;
  const p = ev.payloadRaw || {};
  const parts = [];
  if (p.email) parts.push(`email: ${p.email}`);
  if (p.challenge) parts.push(`challenge: ${String(p.challenge).slice(0, 12)}…`);
  if (p.credentialId) parts.push(`credentialId: ${String(p.credentialId).slice(0, 12)}…`);
  if (p.success !== undefined) parts.push(`success: ${p.success}`);
  if (p.verified !== undefined) parts.push(`verified: ${p.verified}`);
  if (Array.isArray(p.allowCredentials)) parts.push(`${p.allowCredentials.length} credential(s)`);
  return parts.slice(0, 3).join(' · ');
}

// ─── Layout constants ─────────────────────────────────────────────────────────
const ACTOR_W = 170;
const ACTOR_H = 68;
const LANE_PAD = 20;
const HEADER_H = 88;
const LIFELINE_TOP = HEADER_H + 10;

// Each row has: arrow line + label box above + payload box below the arrow
// We compute row heights dynamically based on payload field count.
const ARROW_ZONE = 36;        // pixels from top of row to arrow line (label sits above)
const PAYLOAD_BOX_PAD = 8;    // padding inside payload box
const PAYLOAD_LINE_H = 13;    // height per payload field line
const PAYLOAD_TOP_GAP = 6;    // gap between arrow line and top of payload box
const LABEL_FONT = 10;
const SUB_FONT = 8;
const ROW_SPACING = 18;       // extra gap between rows
const PAYLOAD_VALUE_MAX_CHARS = 22;
const PAYLOAD_LINE_MAX_CHARS = 34;

function actorX(actorIdx) {
  return LANE_PAD + actorIdx * (ACTOR_W + LANE_PAD) + ACTOR_W / 2;
}

function actorIndex(actorName) {
  const normalized = String(actorName || '').trim().toLowerCase();
  return ACTORS.findIndex((actor) => actor.toLowerCase() === normalized);
}

// Build a short list of payload preview lines for the on-diagram box
// Returns array of strings, max 5 lines
function buildPayloadPreviewLines(ev) {
  const p = ev.payloadRaw;
  if (!p || typeof p !== 'object') return [];

  const step = String(ev.step || '').toLowerCase();
  const endpoint = String(ev.endpoint || '').toLowerCase();

  // Avoid repeating large JWT payloads in multiple adjacent timeline boxes.
  if (step === 'http.response' && endpoint === '/webauthn/authenticate/complete' && (p.accessToken || p.refreshToken)) {
    return [
      `success: ${String(Boolean(p.success))}`,
      'jwtPayload: { ... }',
      `mode: ${p.insecureDemoMode ? 'insecure-demo' : 'secure-standard'}`,
    ];
  }

  if (step === 'authentication.complete.response' && (p.accessToken || p.refreshToken)) {
    return [
      `success: ${String(Boolean(p.success))}`,
      `jwtMode: ${p.jwtMode || (p.insecureDemoMode ? 'insecure-demo' : 'secure-standard')}`,
      'jwtPayload: { ... }',
    ];
  }

  const lines = [];
  const keys = Object.keys(p);
  const trimWithEllipsis = (input, maxChars) => {
    const str = String(input);
    return str.length > maxChars ? `${str.slice(0, maxChars - 1)}…` : str;
  };

  for (const k of keys) {
    if (lines.length >= 5) break;
    const v = p[k];
    let vStr = '';
    if (typeof v === 'string') {
      vStr = trimWithEllipsis(v, PAYLOAD_VALUE_MAX_CHARS);
    } else if (v === null) {
      vStr = 'null';
    } else if (typeof v === 'number' || typeof v === 'boolean') {
      vStr = String(v);
    } else if (Array.isArray(v)) {
      vStr = `[${v.length} items]`;
    } else if (typeof v === 'object' && v !== null) {
      vStr = '{…}';
    }
    const keyLabel = trimWithEllipsis(k, 14);
    lines.push(trimWithEllipsis(`${keyLabel}: ${vStr}`, PAYLOAD_LINE_MAX_CHARS));
  }
  return lines;
}

function estimateWrappedLineCount(text, maxChars = 26, maxLines = 3) {
  if (!text) return 1;
  const words = String(text).split(' ');
  let lineCount = 1;
  let current = '';
  for (const word of words) {
    const next = (current ? `${current} ${word}` : word);
    if (next.length > maxChars && current) {
      lineCount += 1;
      current = word;
      if (lineCount >= maxLines) return maxLines;
    } else {
      current = next;
    }
  }
  return Math.min(lineCount, maxLines);
}

// Compute the pixel height that a given event row needs
function rowHeight(ev) {
  const { from, to } = routeRawEvent(ev);
  const fromIdx = actorIndex(from);
  const toIdx = actorIndex(to);
  const isSelf = fromIdx === toIdx || fromIdx < 0 || toIdx < 0;

  const labelLineCount = estimateWrappedLineCount(buildLabel(ev), 26, 3);
  const sublabel = buildSublabel(ev);
  const previewLines = buildPayloadPreviewLines(ev);
  const sublabelLineCount = previewLines.length === 0 ? estimateWrappedLineCount(sublabel, 32, 3) : 0;
  const textBlockH = labelLineCount * 13 + (sublabelLineCount > 0 ? sublabelLineCount * 11 + 4 : 0);

  const payloadBoxH = previewLines.length > 0
    ? PAYLOAD_BOX_PAD * 2 + previewLines.length * PAYLOAD_LINE_H
    : 0;

  if (isSelf) {
    const noteH = PAYLOAD_BOX_PAD * 2 + textBlockH + (previewLines.length > 0 ? previewLines.length * PAYLOAD_LINE_H + 6 : 0);
    return ARROW_ZONE + noteH + 12 + ROW_SPACING;
  }

  return ARROW_ZONE + Math.max(14, textBlockH) + payloadBoxH + PAYLOAD_TOP_GAP + ROW_SPACING;
}

// Compute cumulative Y offsets for each event row
function computeRowOffsets(events) {
  const offsets = [];
  let y = HEADER_H;
  for (const ev of events) {
    offsets.push(y);
    y += rowHeight(ev);
  }
  return { offsets, totalH: y + ACTOR_H + 24 };
}

// ─── SVG sequence diagram renderer ────────────────────────────────────────────
function SequenceDiagram({ events, selectedIdx, onSelect }) {
  if (!events || events.length === 0) return null;

  // Show only one arrow for JWT issuance/response: prefer authentication.jwt.issued over http.response for /webauthn/authenticate/complete
  const hasJwtIssued = events.some(ev => ev.step === 'authentication.jwt.issued');
  const filteredEvents = events.filter(ev => {
    // If both exist, hide http.response for /webauthn/authenticate/complete
    if (
      hasJwtIssued &&
      ev.step === 'http.response' &&
      ev.endpoint === '/webauthn/authenticate/complete'
    ) {
      return false;
    }
    return true;
  });

  const totalWidth = ACTORS.length * (ACTOR_W + LANE_PAD) + LANE_PAD;
  const actorPositions = ACTORS.map((_, i) => actorX(i));
  const { offsets, totalH } = computeRowOffsets(events);
  const diagramH = totalH;

  function wrapText(text, maxChars = 26) {
    if (!text) return [''];
    const words = String(text).split(' ');
    const lines = [];
    let cur = '';
    for (const w of words) {
      if ((cur + ' ' + w).trim().length > maxChars && cur) {
        lines.push(cur.trim());
        cur = w;
      } else {
        cur = (cur + ' ' + w).trim();
      }
    }
    if (cur) lines.push(cur.trim());
    return lines.slice(0, 3);
  }

  return (
    <svg
      viewBox={`0 0 ${totalWidth} ${diagramH}`}
      width="100%"
      style={{ display: 'block', minHeight: diagramH, fontFamily: "'IBM Plex Mono', 'JetBrains Mono', monospace" }}
    >
      <defs>
        {Object.entries(ARROW_COLORS).map(([style, color]) => (
          <marker key={style} id={`arrow-${style}`} markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
            <path d="M0,0 L0,6 L8,3 z" fill={color} />
          </marker>
        ))}
        {/* Drop shadow for selected boxes */}
        <filter id="sel-shadow" x="-10%" y="-10%" width="120%" height="120%">
          <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="#0969da" floodOpacity="0.25" />
        </filter>
      </defs>

      {/* White diagram background */}
      <rect x={0} y={0} width={totalWidth} height={diagramH} fill="#ffffff" />

      {/* Lane backgrounds */}
      {ACTORS.map((actor, i) => (
        <rect
          key={actor + '-lane'}
          x={LANE_PAD + i * (ACTOR_W + LANE_PAD)}
          y={0}
          width={ACTOR_W}
          height={diagramH}
          fill={ACTOR_META[actor].laneColor}
        />
      ))}

      {/* Lane separator lines */}
      {ACTORS.map((actor, i) => (
        <line
          key={actor + '-sep'}
          x1={LANE_PAD + i * (ACTOR_W + LANE_PAD)}
          y1={0}
          x2={LANE_PAD + i * (ACTOR_W + LANE_PAD)}
          y2={diagramH}
          stroke={T.border}
          strokeWidth={0.5}
        />
      ))}

      {/* Actor header boxes */}
      {ACTORS.map((actor, i) => {
        const cx = actorPositions[i];
        const meta = ACTOR_META[actor];
        return (
          <g key={actor + '-header'}>
            <rect
              x={cx - ACTOR_W / 2 + 6}
              y={8}
              width={ACTOR_W - 12}
              height={ACTOR_H}
              rx={8}
              fill={meta.color}
              stroke={meta.borderColor}
              strokeWidth={1.5}
            />
            <text x={cx} y={32} textAnchor="middle" fontSize={20}>{meta.icon}</text>
            <text x={cx} y={52} textAnchor="middle" fontSize={11} fontWeight="700" fill={meta.textColor}>{meta.label}</text>
            <text x={cx} y={66} textAnchor="middle" fontSize={9} fill={meta.textColor} opacity={0.65}>{meta.sublabel}</text>
          </g>
        );
      })}

      {/* Lifelines */}
      {ACTORS.map((actor, i) => (
        <line
          key={actor + '-lifeline'}
          x1={actorPositions[i]}
          y1={LIFELINE_TOP}
          x2={actorPositions[i]}
          y2={diagramH - 30}
          stroke={ACTOR_META[actor].borderColor}
          strokeWidth={1.5}
          strokeOpacity={0.5}
          strokeDasharray="5,7"
        />
      ))}

      {/* Events / arrows */}
      {events.map((ev, idx) => {
        const { from, to } = routeRawEvent(ev);
        const fromIdx = actorIndex(from);
        const toIdx = actorIndex(to);
        const rowY = offsets[idx];
        const rh = rowHeight(ev);
        const arrowColor = ARROW_COLORS[inferArrowStyle(ev)] || T.arrowInternal;
        const label = buildLabel(ev);
        const sublabel = buildSublabel(ev);
        const isSelected = idx === selectedIdx;
        const isSelf = fromIdx === toIdx || fromIdx < 0 || toIdx < 0;

        const x1 = fromIdx >= 0 ? actorPositions[fromIdx] : actorPositions[1];
        const x2 = toIdx >= 0 ? actorPositions[toIdx] : actorPositions[1];

        const labelLines = wrapText(label, 26);
        const sublabelLines = sublabel ? wrapText(sublabel, 32) : [];
        const previewLines = buildPayloadPreviewLines(ev);
        const selfSublabelLines = previewLines.length > 0 ? [] : sublabelLines;

        // Arrow sits ARROW_ZONE px below the top of the row
        const arrowY = rowY + ARROW_ZONE;

        // Payload box: starts PAYLOAD_TOP_GAP below arrow, floats over lane
        const payloadBoxY = arrowY + PAYLOAD_TOP_GAP + 4;
        const payloadBoxH = previewLines.length > 0
          ? PAYLOAD_BOX_PAD * 2 + previewLines.length * PAYLOAD_LINE_H
          : 0;

        // Box color from arrow style
        const boxBg = {
          http: '#eff6ff',
          webauthn: '#f0fdf4',
          db: '#faf5ff',
          internal: '#f8f9fa',
          crypto: '#fff7ed',
        }[inferArrowStyle(ev)] || '#f8f9fa';

        // Self / note box
        if (isSelf) {
          const laneIdx = fromIdx >= 0 ? fromIdx : (toIdx >= 0 ? toIdx : 1);
          const laneX = LANE_PAD + laneIdx * (ACTOR_W + LANE_PAD);
          const noteW = ACTOR_W - 16;
          const noteX = laneX + (ACTOR_W - noteW) / 2;
          const cx = noteX + noteW / 2;
          const noteH = PAYLOAD_BOX_PAD * 2
            + labelLines.length * 13
            + (selfSublabelLines.length > 0 ? selfSublabelLines.length * 11 + 4 : 0)
            + (previewLines.length > 0 ? previewLines.length * PAYLOAD_LINE_H + 6 : 0);

          return (
            <g key={ev.uiId || idx} onClick={() => onSelect(idx)} style={{ cursor: 'pointer' }}>
              {/* Row hover band */}
              <rect x={0} y={rowY} width={totalWidth} height={rh} fill={isSelected ? arrowColor : 'transparent'} opacity={0.04} />
              {isSelected && (
                <rect x={0} y={rowY} width={totalWidth} height={rh} fill="none"
                  stroke={arrowColor} strokeWidth={1.5} strokeOpacity={0.3} />
              )}
              {/* Note box */}
              <rect x={noteX} y={arrowY - 4} width={noteW} height={noteH + 8} rx={6}
                fill={isSelected ? boxBg : '#f8f9fa'}
                stroke={isSelected ? arrowColor : T.border}
                strokeWidth={isSelected ? 2 : 1}
                filter={isSelected ? 'url(#sel-shadow)' : undefined}
              />
              {labelLines.map((ln, li) => (
                <text key={li} x={cx} y={arrowY + 10 + li * 13}
                  textAnchor="middle" fontSize={LABEL_FONT} fill={arrowColor} fontWeight="700">{ln}</text>
              ))}
              {selfSublabelLines.map((ln, li) => (
                <text key={'s' + li} x={cx}
                  y={arrowY + 10 + labelLines.length * 13 + li * 11 + 2}
                  textAnchor="middle" fontSize={SUB_FONT} fill={T.textMuted}>{ln}</text>
              ))}
              {previewLines.map((ln, li) => (
                <text key={'p' + li} x={noteX + PAYLOAD_BOX_PAD}
                  y={arrowY + 10 + labelLines.length * 13 + (selfSublabelLines.length > 0 ? selfSublabelLines.length * 11 + 6 : 0) + li * PAYLOAD_LINE_H + 4}
                  fontSize={8} fill={T.textMuted} fontFamily="monospace">{ln}</text>
              ))}
            </g>
          );
        }

        const goesRight = x2 > x1;
        const arrowHeadX = x2 + (goesRight ? -10 : 10);
        const midX = (x1 + x2) / 2;

        // Payload box centered between actors, capped to lane boundaries
        const boxW = Math.min(Math.abs(x2 - x1) - 16, 260);
        const boxX = midX - boxW / 2;

        // Label sits above arrow line
        const labelBaseY = arrowY - 6;

        return (
          <g key={ev.uiId || idx} onClick={() => onSelect(idx)} style={{ cursor: 'pointer' }}>
            {/* Full-width row selection highlight */}
            {isSelected && (
              <rect x={0} y={rowY} width={totalWidth} height={rh}
                fill={arrowColor} fillOpacity={0.05}
                stroke={arrowColor} strokeWidth={1} strokeOpacity={0.2}
              />
            )}

            {/* Invisible hit area for the whole row */}
            <rect x={0} y={rowY} width={totalWidth} height={rh} fill="transparent" />

            {/* Arrow line */}
            <line
              x1={x1} y1={arrowY} x2={arrowHeadX} y2={arrowY}
              stroke={arrowColor}
              strokeWidth={isSelected ? 2.5 : 1.5}
              markerEnd={`url(#arrow-${inferArrowStyle(ev)})`}
            />

            {/* Origin dot */}
            <circle cx={x1} cy={arrowY} r={3.5} fill={arrowColor} />

            {/* Label lines above arrow */}
            {labelLines.map((ln, li) => (
              <text
                key={li}
                x={midX}
                y={labelBaseY - (labelLines.length - 1 - li) * 13}
                textAnchor="middle"
                fontSize={LABEL_FONT}
                fontWeight="700"
                fill={arrowColor}
                style={{ userSelect: 'none' }}
              >{ln}</text>
            ))}

            {/* Payload box — opaque, colored, below arrow line */}
            {previewLines.length > 0 && (
              <g>
                <rect
                  x={boxX}
                  y={payloadBoxY}
                  width={boxW}
                  height={payloadBoxH}
                  rx={5}
                  fill={boxBg}
                  stroke={isSelected ? arrowColor : T.border}
                  strokeWidth={isSelected ? 1.5 : 1}
                  filter={isSelected ? 'url(#sel-shadow)' : undefined}
                />
                {previewLines.map((ln, li) => (
                  <text
                    key={'p' + li}
                    x={boxX + PAYLOAD_BOX_PAD}
                    y={payloadBoxY + PAYLOAD_BOX_PAD + 9 + li * PAYLOAD_LINE_H}
                    fontSize={8}
                    fill={T.textMuted}
                    fontFamily="monospace"
                    style={{ userSelect: 'none' }}
                  >{ln}</text>
                ))}
              </g>
            )}

            {/* Sublabel (if no payload box — avoids double-text) */}
            {previewLines.length === 0 && sublabel && sublabelLines.map((ln, li) => (
              <text
                key={'s' + li}
                x={midX}
                y={arrowY + 14 + li * 11}
                textAnchor="middle"
                fontSize={SUB_FONT}
                fill={T.textMuted}
                style={{ userSelect: 'none' }}
              >{ln}</text>
            ))}
          </g>
        );
      })}

      {/* Footer actor boxes */}
      {ACTORS.map((actor, i) => {
        const cx = actorPositions[i];
        const meta = ACTOR_META[actor];
        return (
          <g key={actor + '-footer'}>
            <rect
              x={cx - ACTOR_W / 2 + 6}
              y={diagramH - ACTOR_H - 8}
              width={ACTOR_W - 12}
              height={ACTOR_H}
              rx={8}
              fill={meta.color}
              stroke={meta.borderColor}
              strokeWidth={1.5}
            />
            <text x={cx} y={diagramH - ACTOR_H + 16} textAnchor="middle" fontSize={20}>{meta.icon}</text>
            <text x={cx} y={diagramH - ACTOR_H + 36} textAnchor="middle" fontSize={11} fontWeight="700" fill={meta.textColor}>{meta.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

// ─── Detail panel ─────────────────────────────────────────────────────────────
const TYPE_STYLES = {
  success: { border: '#1a7f37', bg: '#dcfce7', dot: '#1a7f37', label: '#1a7f37' },
  error:   { border: '#cf222e', bg: '#ffeef0', dot: '#cf222e', label: '#cf222e' },
  warning: { border: '#9a6700', bg: '#fef9c3', dot: '#9a6700', label: '#9a6700' },
  info:    { border: '#0969da', bg: '#dbeafe', dot: '#0969da', label: '#0969da' },
};

function AnnotationCard({ ann }) {
  const s = TYPE_STYLES[ann.type] || TYPE_STYLES.info;
  return (
    <div style={{
      border: `1px solid ${s.border}`,
      background: s.bg,
      borderRadius: 8,
      padding: '10px 12px',
      marginBottom: 8,
      display: 'flex',
      gap: 10,
      alignItems: 'flex-start',
    }}>
      <div style={{
        width: 8, height: 8, borderRadius: '50%',
        background: s.dot, flexShrink: 0, marginTop: 4,
      }} />
      <div>
        <div style={{ fontWeight: 700, color: s.label, fontSize: 12, marginBottom: 3 }}>{ann.label}</div>
        <div style={{ color: '#1f2328', fontSize: 13, lineHeight: 1.55 }}>{ann.detail}</div>
      </div>
    </div>
  );
}

function generateAnnotations(ev) {
  if (!ev) return [];
  if (ev.summaryAnnotations) return ev.summaryAnnotations.slice(0, 3);

  const annotations = [];
  const p = ev.payloadRaw || {};
  const step = (ev.step || '').toLowerCase();

  if (ev.method && ev.endpoint) {
    annotations.push({
      type: 'info',
      label: `${ev.method} ${ev.endpoint}`,
      detail: ev.method === 'POST'
        ? `Sends data to the server endpoint "${ev.endpoint}".`
        : `HTTP ${ev.method} to ${ev.endpoint}.`,
    });
  }

  if (ev.statusCode !== undefined) {
    const code = ev.statusCode;
    annotations.push({
      type: code >= 200 && code < 300 ? 'success' : code >= 400 ? 'error' : 'warning',
      label: `HTTP ${code}`,
      detail: code === 200
        ? 'The request completed successfully.'
        : code === 400 ? 'Bad request — a field may be missing or malformed.'
        : code === 401 ? 'Unauthorized — the passkey or token was not accepted.'
        : code >= 500 ? 'Server error — an unexpected problem occurred on the backend.'
        : `HTTP ${code}`,
    });
  }

  if (step === 'authentication.jwt.issued') {
    annotations.push({
      type: 'warning',
      label: 'Insecure demo token exposure',
      detail: 'This event contains real JWT values for teaching/debugging. In production, tokens should never be exposed in trace payloads.',
    });
    annotations.push({
      type: 'info',
      label: 'Cookies configured for demo',
      detail: 'Cookie flags may be relaxed in this mode (for example sameSite=false) to make the full flow visible in local testing.',
    });
  }

  if (step.startsWith('db.query.')) {
    annotations.push({
      type: 'info',
      label: 'Database query started',
      detail: 'The backend is asking MySQL for data or updating a row. This is the request side of the database round trip.',
    });
  }

  if (step.startsWith('db.result.')) {
    if (p.ok === true) {
      annotations.push({
        type: 'success',
        label: 'Database response OK',
        detail: `MySQL returned successfully.${typeof p.rowCount === 'number' ? ` Rows matched: ${p.rowCount}.` : ''}`,
      });
    }
    if (p.error === null) {
      annotations.push({
        type: 'info',
        label: 'No database error',
        detail: 'error is null, which means the query completed without a MySQL error.',
      });
    } else if (typeof p.error === 'string' && p.error.trim().length > 0) {
      annotations.push({
        type: 'error',
        label: 'Database error reported',
        detail: `MySQL returned an error message: ${p.error}`,
      });
    }
  }

  if (p.challenge) {
    annotations.push({
      type: 'info',
      label: 'Challenge present',
      detail: `A one-time cryptographic nonce. Expires after ${p.timeout ? Math.round(p.timeout / 1000) + 's' : 'a short window'}. Signing it prevents replay attacks.`,
    });
  }

  if (p.verified === true) {
    annotations.push({ type: 'success', label: 'Signature verified', detail: 'The cryptographic signature matched the stored public key. Challenge, origin, and counter all checked out.' });
  } else if (p.verified === false) {
    annotations.push({ type: 'error', label: 'Verification failed', detail: 'Signature did not match, challenge was wrong/expired, origin mismatch, or counter regressed.' });
  }

  if (p.counterDidRegress === true) {
    annotations.push({ type: 'error', label: 'Counter regression', detail: `Reported ${p.reportedCounter} < stored ${p.storedCounter}. Possible cloned credential.` });
  } else if (p.counterDidRegress === false && p.storedCounter === 0 && p.reportedCounter === 0) {
    annotations.push({ type: 'info', label: 'Counter not implemented', detail: 'Both counters are 0. Platform authenticators (Face ID, Windows Hello) often do not increment counters. This is normal and safe.' });
  } else if (p.counterDidRegress === false && p.nextCounter !== undefined) {
    annotations.push({ type: 'success', label: 'Counter advanced', detail: `Counter moved ${p.storedCounter} → ${p.nextCounter}. No cloning detected.` });
  }

  if (p.success === true && p.verified === undefined) {
    annotations.push({ type: 'success', label: 'Operation succeeded', detail: 'The server confirmed success. User is now authenticated (or registered).' });
  }

  if (step === 'browser.create.completed' && p.hasResponse) {
    annotations.push({ type: 'success', label: 'Key pair created', detail: 'The authenticator generated a new EC key pair. Private key is stored in secure hardware and never leaves the device.' });
  }

  if (step === 'browser.get.completed' && p.hasResponse) {
    annotations.push({ type: 'success', label: 'Assertion signed', detail: 'The user completed the biometric gesture. The private key signed the challenge. Sending to server for verification.' });
  }

  if (annotations.length === 0) {
    annotations.push({ type: 'info', label: 'Step recorded', detail: 'This event marks an internal state transition in the WebAuthn ceremony.' });
  }

  return annotations.slice(0, 3);
}

function fieldDescription(key, value) {
  const desc = {
    challenge: 'A unique random nonce generated per ceremony. The authenticator signs it; the server verifies the signed value matches what it issued. Prevents replay attacks.',
    rp: 'Relying Party — the website this passkey is bound to. Contains id (domain) and name (display label).',
    rpId: `Domain the passkey is locked to ("${value}"). Passkeys cannot be used on any other origin — core anti-phishing guarantee.`,
    user: 'Account being enrolled: id (opaque bytes → userHandle), name (email), displayName (friendly label).',
    pubKeyCredParams: `Ordered list of accepted algorithms. Device picks the first it supports. (${Array.isArray(value) ? value.length : '?'} offered)`,
    authenticatorSelection: 'Constraints: attachment (platform/cross-platform), residentKey (discoverable), userVerification.',
    authenticatorAttachment: value === 'platform' ? 'Built-in sensor only (Face ID, fingerprint, Windows Hello).' : 'Roaming key (USB, NFC, BLE).',
    residentKey: value === 'required' ? 'Discoverable credential required — enables username-less login.' : `residentKey: ${value}`,
    attestation: value === 'direct' ? 'Raw attestation cert requested — server wants to verify authenticator make/model.' : `attestation: ${value}`,
    allowCredentials: `Passkeys accepted for this login. Browser filters device credentials to match. (${Array.isArray(value) ? value.length : '?'} listed)`,
    userVerification: `"${value}" — ${value === 'required' ? 'biometric/PIN mandatory.' : value === 'preferred' ? 'biometric/PIN if available.' : 'presence only.'}`,
    timeout: `Browser waits ${typeof value === 'number' ? Math.round(value / 1000) + 's' : value} for user gesture.`,
    transports: `Transport(s): ${Array.isArray(value) ? value.join(', ') : value}. Tells browser which UI to show.`,
    id: 'Credential ID — identifies which passkey to use. Not secret.',
    rawId: 'Credential ID in original binary (Base64) form.',
    type: value === 'public-key' ? 'Standard WebAuthn credential type — uses asymmetric key pair.' : `type: ${value}`,
    authenticatorData: 'Binary blob: rpIdHash + flags (UV/UP bits) + sign counter + optional extensions. Server checks all of these.',
    clientDataJSON: 'Browser-assembled JSON: type (webauthn.get/create) + challenge + origin. Authenticator signs this; server verifies.',
    signature: 'The cryptographic proof. Private key signed (authenticatorData ‖ hash(clientDataJSON)). Server verifies with stored public key.',
    userHandle: 'Opaque bytes linking the passkey to a user account. Enables username-less login. Should not contain PII.',
    attestationObject: 'CBOR bundle: new public key + authenticatorData + attestation statement (cert chain). Only present during registration.',
    publicKey: 'The public half of the key pair (COSE-encoded). Stored permanently. Cannot produce signatures; only verify them.',
    publicKeyAlgorithm: `Algorithm: ${value === -7 ? 'ES256 (ECDSA/P-256)' : value === -257 ? 'RS256 (RSA)' : value === -8 ? 'EdDSA (Ed25519)' : value}`,
    verified: value ? 'Cryptographic signature + challenge + origin + counter all passed.' : 'Verification failed. See earlier events for details.',
    storedCounter: `Sign-count the server had stored (${value}). Used to detect cloned credentials.`,
    reportedCounter: `Sign-count the authenticator reported this time (${value}). Must be ≥ stored value.`,
    nextCounter: `New counter to store (${value}). Next login must report ≥ this value.`,
    counterDidRegress: value ? 'Counter went backwards — possible credential clone.' : 'Counter OK — no cloning detected.',
    ok: value === true
      ? 'Boolean success flag from backend/database instrumentation. true means the DB operation completed successfully.'
      : 'false means the DB operation failed or returned an unexpected state.',
    rowCount: `How many rows matched/returned for this DB operation (${value}). For lookups, 1 usually means one user or credential row was found.`,
    error: value === null
      ? 'No database error occurred. null here is good and means the SQL operation succeeded.'
      : `Database error text. Non-null values indicate a SQL/connection issue: ${value}`,
    operation: `Database action type: "${value}". Common values: select (read), insert (create), update (modify).`,
    accessToken: 'JWT access token. In this demo it is intentionally visible in the payload for inspection. In production this should remain hidden and only stored in secure, httpOnly cookies.',
    refreshToken: 'JWT refresh token. In this demo it is intentionally visible for learning. In production it should be protected and never exposed in trace payloads.',
    jwtMode: value === 'insecure-demo'
      ? 'This response was requested in insecure demo mode, so JWT payload values are intentionally visible.'
      : 'This response used secure-standard mode, so JWT payload values should not be exposed in logs.',
    cookieOptions: 'Cookie security settings applied when issuing JWT cookies (httpOnly, secure, sameSite, path).',
    insecureDemoMode: value
      ? 'true means the app is intentionally running in insecure demo mode for visibility/testing.'
      : 'false means normal safer defaults are expected.',
    sameSite: `Cookie sameSite option is "${value}". false disables same-site protection; this is insecure and should only be used for demos.`,
    secure: value
      ? 'true means the cookie is sent only over HTTPS.'
      : 'false means cookie can be sent over HTTP; insecure and demo-only.',
    httpOnly: value
      ? 'true means JavaScript cannot read this cookie directly (safer default).'
      : 'false means JavaScript can read this cookie; this is less secure.',
    success: value ? 'Server confirmed success.' : 'Server returned failure.',
    email: `Account identifier used to look up registered passkeys. Value: "${value}"`,
    hasResponse: value ? 'Browser returned a credential object — user completed the gesture.' : 'No credential returned — cancelled or no passkey found.',
    hasAssertion: value ? 'Signed assertion received by backend, ready to verify.' : 'No assertion received.',
    hasCredential: value ? 'Credential object received by backend for registration.' : 'No credential in request.',
    hasRegistrationInfo: value ? 'Verification returned registration info including the new public key.' : '',
    origin: `Page origin that initiated the ceremony ("${value}"). Authenticator signs this; server verifies to block phishing.`,
    crossOrigin: value ? 'Cross-origin ceremony (iframe on different domain). Usually rejected.' : 'Same-origin — normal case.',
    alg: `COSE algorithm code ${value} = ${value === -7 ? 'ES256' : value === -257 ? 'RS256' : value === -8 ? 'EdDSA' : value}`,
    assertion: 'Full signed response from authenticator: id + authenticatorData + clientDataJSON + signature + userHandle.',
    credential: 'Full credential object from authenticator: id + attestationObject + authenticatorData + clientDataJSON + publicKey.',
  };
  return desc[key] || '';
}

function PayloadTree({ payload, depth = 0 }) {
  if (!payload || typeof payload !== 'object') {
    return <span style={{ color: T.accent }}>{String(payload)}</span>;
  }
  if (Array.isArray(payload)) {
    return (
      <div style={{ paddingLeft: depth > 0 ? 14 : 0 }}>
        {payload.map((item, i) => (
          <div key={i} style={{ marginBottom: 6 }}>
            <span style={{ color: T.textMuted, fontSize: 11 }}>[{i}]</span>
            {typeof item === 'object' ? <PayloadTree payload={item} depth={depth + 1} /> : (
              <span style={{ color: T.accent, marginLeft: 6, fontSize: 12 }}>{String(item)}</span>
            )}
          </div>
        ))}
      </div>
    );
  }
  return (
    <div style={{ paddingLeft: depth > 0 ? 14 : 0 }}>
      {Object.entries(payload).map(([key, value]) => {
        const desc = fieldDescription(key, value);
        return (
          <div key={key} style={{ marginBottom: 10, borderLeft: depth > 0 ? `2px solid ${T.border}` : 'none', paddingLeft: depth > 0 ? 8 : 0 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 700, color: T.purple, fontSize: 12 }}>{key}</span>
              {typeof value !== 'object' && (
                <span style={{ fontFamily: 'monospace', color: T.orange, fontSize: 12 }}>
                  {String(value).length > 60 ? String(value).slice(0, 60) + '…' : String(value)}
                </span>
              )}
              {Array.isArray(value) && (
                <span style={{ color: T.textMuted, fontSize: 11 }}>[ {value.length} items ]</span>
              )}
              {typeof value === 'object' && !Array.isArray(value) && value !== null && (
                <span style={{ color: T.textMuted, fontSize: 11 }}>{'{ … }'}</span>
              )}
            </div>
            {desc && (
              <div style={{ color: '#92400e', fontSize: 12, marginTop: 2, lineHeight: 1.5, fontStyle: 'italic' }}>{desc}</div>
            )}
            {typeof value === 'object' && value !== null && (
              <PayloadTree payload={value} depth={depth + 1} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Legend ───────────────────────────────────────────────────────────────────
function Legend() {
  const items = [
    { color: T.arrowHttp,    label: 'HTTP request/response' },
    { color: T.arrowWebAuthn,label: 'WebAuthn / Authenticator' },
    { color: T.arrowDb,      label: 'Database query/result' },
    { color: T.arrowInternal,label: 'Internal step / note' },
  ];  return (
    <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginBottom: 12 }}>
      {items.map(({ color, label }) => (
        <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <svg width={28} height={10}>
            <line x1={0} y1={5} x2={22} y2={5} stroke={color} strokeWidth={2} />
            <polygon points="22,2 28,5 22,8" fill={color} />
          </svg>
          <span style={{ fontSize: 12, color: T.textMuted }}>{label}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
const FlowSequenceDiagram = () => {
  const [events, setEvents] = useState([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [selectedFile, setSelectedFile] = useState(null);
  const [flowType, setFlowType] = useState('');
  const [error, setError] = useState('');
  const [copiedPayload, setCopiedPayload] = useState(false);
  const diagramContainerRef = useRef(null);

  const handleFileChange = (e) => {
    setSelectedFile(e.target.files[0] || null);
    setError('');
  };

  const handleLoad = () => {
    if (!selectedFile) { setError('No file selected.'); return; }
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const json = JSON.parse(evt.target.result);
        let rawEvents = [];
        if (Array.isArray(json.mergedTimeline)) rawEvents = json.mergedTimeline;
        else if (Array.isArray(json.frontendEvents) || Array.isArray(json.backendEvents)) {
          rawEvents = [
            ...(json.frontendEvents || []),
            ...(json.backendEvents || []),
          ].sort((a, b) => Date.parse(a.timestamp || 0) - Date.parse(b.timestamp || 0));
        } else if (Array.isArray(json)) rawEvents = json;

        if (!rawEvents.length) { setError('No events found in file.'); return; }

        const ft = rawEvents.find(e => e.flowType)?.flowType || '';
        setFlowType(ft);

        const synth = buildSyntheticEvents(rawEvents, ft);
        const merged = mergeAndSortEvents(rawEvents, synth);
        setEvents(merged);
        setSelectedIdx(0);
        setError('');
      } catch {
        setError('Invalid JSON file — could not parse.');
      }
    };
    reader.readAsText(selectedFile);
  };

  const selectedEvent = events[selectedIdx] || null;
  const annotations = generateAnnotations(selectedEvent);
  const { from, to } = selectedEvent ? routeRawEvent(selectedEvent) : { from: '', to: '' };

  const handleCopyPayload = useCallback(async () => {
    if (!selectedEvent?.payloadRaw) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(selectedEvent.payloadRaw, null, 2));
      setCopiedPayload(true);
      setTimeout(() => setCopiedPayload(false), 1200);
    } catch {
      setCopiedPayload(false);
    }
  }, [selectedEvent]);

  // Scroll diagram row into view when selection changes
  useEffect(() => {
    if (!diagramContainerRef.current) return;
    const { offsets } = computeRowOffsets(events);
    const rowY = offsets[selectedIdx] ?? HEADER_H;
    diagramContainerRef.current.scrollTop = Math.max(0, rowY - 120);
  }, [events, selectedIdx]);

  return (
    <div style={{
      minHeight: '100vh',
      background: T.bg,
      color: T.text,
      fontFamily: "'IBM Plex Mono', 'JetBrains Mono', 'Fira Code', monospace",
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* Header bar */}
      <div style={{
        background: T.surface,
        borderBottom: `1px solid ${T.border}`,
        padding: '14px 28px',
        display: 'flex',
        alignItems: 'center',
        gap: 28,
        flexWrap: 'wrap',
        boxShadow: '0 1px 3px rgba(0,0,0,0.07)',
        position: 'relative',
        zIndex: 200,
      }}>
        {/* File controls left-aligned */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <label style={{
            display: 'flex', alignItems: 'center', gap: 8,
            background: T.surfaceAlt, border: `1px solid ${T.border}`,
            borderRadius: 6, padding: '7px 12px', cursor: 'pointer',
            fontSize: 13, color: T.textMuted,
            maxWidth: 220, minWidth: 0, overflow: 'hidden',
          }}>
            <span>📂</span>
            <span style={{
              maxWidth: 120,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              display: 'inline-block',
              verticalAlign: 'bottom',
            }}>{selectedFile ? selectedFile.name : 'Choose JSON export'}</span>
            <input type="file" accept="application/json" onChange={handleFileChange} style={{ display: 'none' }} />
          </label>
          <button
            onClick={handleLoad}
            style={{
              background: T.accent, color: '#ffffff', border: 'none',
              borderRadius: 6, padding: '8px 18px', fontWeight: 700,
              fontSize: 13, cursor: 'pointer', letterSpacing: '0.3px',
            }}
          >
            Load
          </button>
        </div>
        {/* Title and flow type center-aligned */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.5px', color: T.text }}>
            🔑 Passkey Flow Visualizer
          </div>
          <div style={{ fontSize: 12, color: T.textMuted, marginTop: 2 }}>
            WebAuthn ceremony sequence diagram
            {flowType && <span style={{ marginLeft: 8, color: T.accent }}>· {flowType}</span>}
          </div>
        </div>
      </div>

      {/* Disclosure bar below header */}
      <div style={{
        margin: '10px 20px 0',
        border: `1px solid ${T.orange}`,
        background: T.orangeDim,
        color: '#7a3a00',
        borderRadius: 8,
        padding: '8px 12px',
        fontSize: 12,
        lineHeight: 1.5,
        maxWidth: 700,
        alignSelf: 'flex-start',
      }}>
        Insecure demo disclosure: this diagram may include real JWT values and relaxed cookie flags for educational visibility. Do not use this payload mode in production.
      </div>

      {error && (
        <div style={{ background: T.redDim, border: `1px solid ${T.red}`, borderRadius: 6, padding: '10px 20px', margin: '12px 20px', color: T.red, fontSize: 13 }}>
          ⚠️ {error}
        </div>
      )}

      {events.length === 0 && !error && (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16, color: T.textMuted }}>
          <div style={{ fontSize: 48 }}>🔑</div>
          <div style={{ fontSize: 16, fontWeight: 600, color: T.text }}>Load a passkey flow export to begin</div>
          <div style={{ fontSize: 13 }}>Supports registration and authentication JSON exports</div>
        </div>
      )}

      {events.length > 0 && (
        <div style={{
          display: 'flex',
          flex: 1,
          overflow: 'hidden',
          gap: 0,
          marginRight: 'min(30vw, 370px)',
        }}>
          {/* Diagram panel */}
          <div style={{
            flex: 2,
            overflowY: 'auto',
            overflowX: 'auto',
            padding: '20px 16px',
            background: T.bg,
          }} ref={diagramContainerRef}>
            <Legend />
            <div style={{ minWidth: 700 }}>
              <SequenceDiagram
                events={events}
                selectedIdx={selectedIdx}
                onSelect={setSelectedIdx}
              />
            </div>
          </div>

          {/* Detail panel */}
          <div style={{
            width: '28vw',
            maxWidth: 360,
            minWidth: 240,
            flexShrink: 0,
            overflowY: 'auto',
            background: T.surface,
            borderLeft: `1px solid ${T.border}`,
            padding: '20px 0px 50px 20px', // Remove right padding
            position: 'fixed',
            right: 0,
            top: 80,
            height: 'calc(100vh - 96px)',
            zIndex: 100,
            boxShadow: '0 0 16px 0 rgba(0,0,0,0.04)',
            borderRadius: 16,
            display: 'flex',
            flexDirection: 'column',
          }}>
            {selectedEvent ? (
              <>
                {/* DB Preview: Show SQL query and result if present */}
                {selectedEvent.type === 'db' && (selectedEvent.query || selectedEvent.result) && (
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 11, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 8 }}>Database Preview</div>
                    {selectedEvent.query && (
                      <div style={{ marginBottom: 8 }}>
                        <div style={{ fontSize: 12, color: T.purple, fontWeight: 700 }}>SQL Query</div>
                        <pre style={{ background: '#f3e8ff', color: '#6b21a8', fontSize: 12, padding: '8px', borderRadius: 6, border: `1px solid ${T.purpleDim}`, margin: 0 }}>{selectedEvent.query}</pre>
                      </div>
                    )}
                    {selectedEvent.result && (
                      <div>
                        <div style={{ fontSize: 12, color: T.green, fontWeight: 700, marginTop: 6 }}>Result</div>
                        <pre style={{ background: '#dcfce7', color: '#1a7f37', fontSize: 12, padding: '8px', borderRadius: 6, border: `1px solid ${T.greenDim}`, margin: 0 }}>{JSON.stringify(selectedEvent.result, null, 2)}</pre>
                      </div>
                    )}
                  </div>
                )}
                {/* Step badge */}
                <div style={{
                  background: T.surfaceAlt,
                  border: `1px solid ${T.border}`,
                  borderRadius: 8,
                  padding: '12px 14px',
                  marginBottom: 16,
                }}>
                  <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.8px' }}>
                    {selectedEvent._synthetic ? '⬡ synthetic (inferred)' : '● captured event'}
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: T.accent, wordBreak: 'break-all' }}>
                    {selectedEvent.step || selectedEvent.endpoint || 'event'}
                  </div>
                  <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    {[
                      ['From', from],
                      ['To', to],
                      ['Source', selectedEvent.source || '—'],
                      ['Direction', selectedEvent.direction || '—'],
                    ].map(([label, val]) => (
                      <div key={label}>
                        <div style={{ fontSize: 10, color: T.textFaint, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</div>
                        <div style={{ fontSize: 13, color: ACTOR_META[val]?.textColor || T.text, fontWeight: 600 }}>
                          {ACTOR_META[val]?.icon} {ACTOR_META[val]?.label || val}
                        </div>
                      </div>
                    ))}
                    <div style={{ gridColumn: '1/-1' }}>
                      <div style={{ fontSize: 10, color: T.textFaint, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Timestamp</div>
                      <div style={{ fontSize: 12, color: T.textMuted }}>
                        {selectedEvent.timestamp ? new Date(selectedEvent.timestamp).toLocaleString() : '—'}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Navigation */}
                <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                  <button
                    disabled={selectedIdx === 0}
                    onClick={() => setSelectedIdx(i => Math.max(0, i - 1))}
                    style={{
                      flex: 1, background: T.surfaceAlt, border: `1px solid ${T.border}`,
                      borderRadius: 6, color: T.text, cursor: selectedIdx === 0 ? 'not-allowed' : 'pointer',
                      padding: '7px', fontSize: 13, opacity: selectedIdx === 0 ? 0.4 : 1,
                    }}
                  >← Prev</button>
                  <span style={{ lineHeight: '34px', fontSize: 12, color: T.textMuted, minWidth: 60, textAlign: 'center' }}>
                    {selectedIdx + 1} / {events.length}
                  </span>
                  <button
                    disabled={selectedIdx === events.length - 1}
                    onClick={() => setSelectedIdx(i => Math.min(events.length - 1, i + 1))}
                    style={{
                      flex: 1, background: T.surfaceAlt, border: `1px solid ${T.border}`,
                      borderRadius: 6, color: T.text, cursor: selectedIdx === events.length - 1 ? 'not-allowed' : 'pointer',
                      padding: '7px', fontSize: 13, opacity: selectedIdx === events.length - 1 ? 0.4 : 1,
                    }}
                  >Next →</button>
                </div>

                {/* Annotations */}
                {annotations.length > 0 && (
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 11, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 8 }}>Summary</div>
                    {annotations.map((ann, i) => <AnnotationCard key={i} ann={ann} />)}
                  </div>
                )}

                {/* Raw payload */}
                {selectedEvent.payloadRaw && (
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                      <div style={{ fontSize: 11, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.8px' }}>Raw Payload</div>
                      <button
                        type="button"
                        onClick={handleCopyPayload}
                        style={{
                          border: `1px solid ${T.border}`,
                          background: T.surfaceAlt,
                          color: T.text,
                          borderRadius: 6,
                          padding: '4px 8px',
                          fontSize: 11,
                          cursor: 'pointer',
                        }}
                      >
                        {copiedPayload ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                    <pre style={{
                      background: '#f6f8fa', color: '#1f2328', fontSize: 11,
                      lineHeight: 1.6, padding: '12px', borderRadius: 6,
                      overflowX: 'auto', border: `1px solid ${T.border}`,
                      margin: 0,
                    }}>
                      {JSON.stringify(selectedEvent.payloadRaw, null, 2)}
                    </pre>
                  </div>
                )}

                {/* Payload breakdown */}
                {selectedEvent.payloadRaw && (
                  <div>
                    <div style={{ fontSize: 11, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 8 }}>Field Breakdown</div>
                    <div style={{
                      background: T.surfaceAlt, borderRadius: 6,
                      padding: '12px', fontSize: 13,
                      border: `1px solid ${T.border}`,
                    }}>
                      <PayloadTree payload={selectedEvent.payloadRaw} />
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div style={{ color: T.textMuted, textAlign: 'center', marginTop: 60 }}>
                Click an arrow in the diagram to inspect it
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default FlowSequenceDiagram;