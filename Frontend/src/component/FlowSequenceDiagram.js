// ─── Step 1: Add this function above your component ──────────────────────────
//
// Derives human-readable annotations from a single event object.
// Returns an array of annotation objects: { type, label, detail }
//   type:  'info' | 'success' | 'warning' | 'error'
//   label: short title (≤ 5 words)
//   detail: one or two plain-English sentences

function generateAnnotations(event) {
  if (!event) return [];
  const annotations = [];
  const p = event.payloadRaw || {};

  // ── HTTP method + endpoint ────────────────────────────────────────────────
  if (event.method && event.endpoint) {
    const methodDescriptions = {
      POST:   'Sends data to the server to create or trigger something.',
      GET:    'Asks the server to return data without changing anything.',
      PUT:    'Replaces an existing resource on the server entirely.',
      PATCH:  'Updates part of an existing resource on the server.',
      DELETE: 'Removes a resource from the server.',
    };
    annotations.push({
      type: 'info',
      label: `${event.method} ${event.endpoint}`,
      detail: methodDescriptions[event.method] ||
        `HTTP ${event.method} request to ${event.endpoint}.`,
    });
  }

  // ── HTTP status code ──────────────────────────────────────────────────────
  if (event.statusCode !== undefined) {
    const code = event.statusCode;
    let type = 'info';
    let detail = '';
    if (code >= 200 && code < 300) {
      type = 'success';
      if (code === 200) {
        detail = 'HTTP 200: The request worked! Everything went fine.';
      } else {
        detail = `HTTP ${code}: The request worked and the server said it was successful.`;
      }
    } else if (code === 400) {
      type = 'error';
      detail = 'HTTP 400: The server could not understand what was sent. This usually means something is missing or typed wrong.';
    } else if (code === 401) {
      type = 'error';
      detail = 'HTTP 401: You are not allowed to do this yet. You may need to log in or use the right passkey.';
    } else if (code === 403) {
      type = 'error';
      detail = 'HTTP 403: You are not allowed to do this. Even if you are logged in, you do not have permission.';
    } else if (code === 404) {
      type = 'error';
      detail = 'HTTP 404: The thing you asked for was not found. It might not exist or was deleted.';
    } else if (code === 409) {
      type = 'warning';
      detail = 'HTTP 409: There is already something like this. For example, you may be trying to register a passkey that already exists.';
    } else if (code >= 500) {
      type = 'error';
      detail = `HTTP ${code}: The server had a problem and could not finish the request. This is not your fault.`;
    } else {
      type = 'warning';
      detail = `HTTP ${code}: The server sent an unexpected response. Something unusual happened.`;
    }
    annotations.push({ type, label: `HTTP ${code}`, detail });
  }

  // ── Direction context ─────────────────────────────────────────────────────
  if (event.direction === 'inbound' && event.source === 'backend') {
    annotations.push({
      type: 'info',
      label: 'Backend received request',
      detail: 'The server is receiving this event — it will validate inputs and perform the next step in the WebAuthn ceremony.',
    });
  }
  if (event.direction === 'outbound' && event.source === 'backend') {
    annotations.push({
      type: 'info',
      label: 'Backend sending response',
      detail: 'The server is dispatching this response back to the browser. The frontend will process it and continue the flow.',
    });
  }
  if (event.direction === 'inbound' && event.source === 'frontend') {
    annotations.push({
      type: 'info',
      label: 'Frontend received response',
      detail: 'The browser received a response from the server and will now pass the data to the WebAuthn API or update UI state.',
    });
  }
  if (event.direction === 'internal' && event.source === 'frontend' &&
      event.step && event.step.startsWith('browser.')) {
    annotations.push({
      type: 'info',
      label: 'Browser API call',
      detail: 'This event represents a call to a browser-native WebAuthn API (navigator.credentials). No network request is made — the browser talks directly to the device authenticator.',
    });
  }

  // ── Email / account ───────────────────────────────────────────────────────
  const email = p.email || (p.user && p.user.name);
  if (email) {
    annotations.push({
      type: 'info',
      label: 'Account identifier',
      detail: `This event is associated with the account "${email}". The server uses this to look up registered passkeys and build a personalised challenge.`,
    });
  }

  // ── Challenge presence ────────────────────────────────────────────────────
  if (p.challenge) {
    annotations.push({
      type: 'info',
      label: 'Challenge issued',
      detail: `A fresh cryptographic challenge was generated for this request. It expires after ${p.timeout ? Math.round(p.timeout / 1000) + ' seconds' : 'a short window'} and can only be used once, preventing replay attacks.`,
    });
  }

  // ── Credential count in allowCredentials ──────────────────────────────────
  if (Array.isArray(p.allowCredentials)) {
    const count = p.allowCredentials.length;
    if (count === 0) {
      annotations.push({
        type: 'warning',
        label: 'No credentials listed',
        detail: 'The server returned an empty allowCredentials list. This triggers a "discoverable credential" flow — the browser will prompt the user to pick any passkey stored for this site. Make sure the user has registered at least one passkey.',
      });
    } else {
      annotations.push({
        type: 'info',
        label: `${count} passkey${count !== 1 ? 's' : ''} on file`,
        detail: `The server found ${count} registered passkey${count !== 1 ? 's' : ''} for this account and is presenting ${count !== 1 ? 'them' : 'it'} to the browser. The browser will match one against credentials stored on this device.`,
      });
    }
  }

  // ── browser.get result ────────────────────────────────────────────────────
  if (event.step === 'browser.get.completed') {
    if (p.hasResponse === true) {
      annotations.push({
        type: 'success',
        label: 'User gesture completed',
        detail: 'The user successfully completed the passkey gesture (fingerprint, face scan, or PIN). The browser has received a signed assertion and will now send it to the server.',
      });
    } else if (p.hasResponse === false) {
      annotations.push({
        type: 'error',
        label: 'No credential returned',
        detail: 'The browser\'s navigator.credentials.get() call returned nothing. The user may have cancelled the prompt, or no matching passkey was found on this device.',
      });
    }
    if (p.id) {
      annotations.push({
        type: 'info',
        label: 'Credential identified',
        detail: `The authenticator selected the passkey with ID "${p.id}". This ID will be sent to the server so it knows which stored public key to use for signature verification.`,
      });
    }
  }

  // ── Assertion payload ─────────────────────────────────────────────────────
  if (p.assertion) {
    annotations.push({
      type: 'info',
      label: 'Signed assertion present',
      detail: 'The frontend has attached the full signed assertion — authenticatorData, clientDataJSON, and signature — to this request. The server will now cryptographically verify all three.',
    });
    if (p.assertion.response && p.assertion.response.userHandle) {
      annotations.push({
        type: 'info',
        label: 'User handle returned',
        detail: 'The authenticator returned a userHandle, which lets the server identify the account without the user having typed an email. This is the "discoverable credential" (username-less login) mechanism.',
      });
    }
  }

  // ── Verification result ───────────────────────────────────────────────────
  if (p.verified === true) {
    annotations.push({
      type: 'success',
      label: 'Signature verified',
      detail: 'The server validated the cryptographic signature against the stored public key. The challenge matched, the origin was correct, and the counter was acceptable. Authentication succeeded.',
    });
  } else if (p.verified === false) {
    annotations.push({
      type: 'error',
      label: 'Verification failed',
      detail: 'The server rejected the passkey response. Possible causes: the signature did not match the stored public key, the challenge was wrong or expired, the origin was unexpected, or the counter regressed (possible clone detected).',
    });
  }

  // ── Counter analysis ──────────────────────────────────────────────────────
  if (p.counterDidRegress === true) {
    annotations.push({
      type: 'error',
      label: 'Counter regression detected',
      detail: `The authenticator reported a sign-count of ${p.reportedCounter}, which is less than the stored value of ${p.storedCounter}. This can indicate the passkey was cloned to another device. High-security applications should reject or flag this login.`,
    });
  } else if (p.counterDidRegress === false && p.storedCounter !== undefined) {
    if (p.storedCounter === 0 && p.reportedCounter === 0) {
      annotations.push({
        type: 'info',
        label: 'Counter not implemented',
        detail: 'Both the stored and reported counters are 0. The authenticator you used may not use counters by default. This is normal and safe for most devices (like Face ID, Windows Hello, or built-in sensors). Your passkey is still secure.',
      });
    } else {
      annotations.push({
        type: 'success',
        label: 'Counter advanced normally',
        detail: `The sign-count moved from ${p.storedCounter} → ${p.nextCounter}. The counter is incrementing as expected, with no signs of credential cloning.`,
      });
    }
  }

  // ── Final success flag ────────────────────────────────────────────────────
  if (p.success === true && !p.verified) {
    annotations.push({
      type: 'success',
      label: 'Operation succeeded',
      detail: 'The server confirmed the operation completed successfully. The user is now authenticated (or registered, depending on the flow).',
    });
  }
  if (p.success === false) {
    annotations.push({
      type: 'error',
      label: 'Operation failed',
      detail: 'The server returned a failure. Review earlier events in the timeline for the specific error — the root cause usually appears in the preceding backend event.',
    });
  }

  // ── Fallback: nothing generated ───────────────────────────────────────────
  if (annotations.length === 0) {
    annotations.push({
      type: 'info',
      label: 'Internal step',
      detail: 'This is an internal processing event with no notable fields to annotate. It records an intermediate state transition in the WebAuthn ceremony.',
    });
  }

  return annotations;
}

// ─── Step 2: Annotation styles ─────────────────────────────────────────────
const TYPE_STYLES = {
  success: {
    border: '1px solid #c3e6cb',
    background: '#f0faf3',
    labelColor: '#1a6b35',
    dot: '#28a745',
  },
  error: {
    border: '1px solid #f5c6cb',
    background: '#fff5f5',
    labelColor: '#8b1a1a',
    dot: '#dc3545',
  },
  warning: {
    border: '1px solid #ffeeba',
    background: '#fffdf0',
    labelColor: '#856404',
    dot: '#e0a800',
  },
  info: {
    border: '1px solid #bee5eb',
    background: '#f0f8ff',
    labelColor: '#0c5460',
    dot: '#17a2b8',
  },
};
import React, { useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';


// Helper to generate Mermaid sequence diagram from events, with event index for click mapping
// Returns Mermaid diagram string
function generateMermaidSequence(events) {
  if (!Array.isArray(events) || events.length === 0) {
    return 'sequenceDiagram\nNote over Frontend: No events to display';
  }
  let diagram = 'sequenceDiagram\n';
  events.forEach((event, idx) => {
    // Determine message direction
    let from = 'Frontend';
    let to = 'Backend';
    if (event.direction === 'frontend->backend' || event.source === 'frontend') {
      from = 'Frontend';
      to = 'Backend';
    } else if (event.direction === 'backend->frontend' || event.source === 'backend') {
      from = 'Backend';
      to = 'Frontend';
    } else if (event.direction === 'browser->frontend') {
      from = 'Browser';
      to = 'Frontend';
    } else if (event.direction === 'frontend->browser') {
      from = 'Frontend';
      to = 'Browser';
    }
    if (!event.direction && event.source === 'frontend' && event.step && event.step.toLowerCase().includes('browser')) {
      from = 'Browser';
      to = 'Frontend';
    }
    // Main label for the event
    let label = event.step || event.endpoint || event.type || 'event';
    // Build multiline label with <br/>, bold first payload line for HTTP events
    let labelLines = [label];
    // Add payload fields if present
    if (event.payloadRaw && typeof event.payloadRaw === 'object') {
      const keys = Object.keys(event.payloadRaw);
      if (keys.length > 0) {
        keys.forEach((k) => {
          let v = event.payloadRaw[k];
          let vStr = '';
          if (typeof v === 'string') {
            vStr = v;
            // Remove leading/trailing double quotes if present
            if (vStr.startsWith('"') && vStr.endsWith('"') && vStr.length > 1) {
              vStr = vStr.slice(1, -1);
            }
          } else if (typeof v === 'number' || typeof v === 'boolean') vStr = String(v);
          else if (Array.isArray(v)) vStr = `[${v.length} items]`;
          else if (typeof v === 'object' && v !== null) vStr = '{...}';
          vStr = vStr.length > 60 ? vStr.slice(0, 60) + '…' : vStr;
          labelLines.push(`${k}: ${vStr}`);
        });
      }
    }
    // Mermaid multiline label: join with <br/>, do not wrap in double quotes
    // Mermaid multiline label: join with <br/>, do not wrap in double quotes
    let mermaidLabel = labelLines.join('<br/>');
    // Determine arrow direction
    // Use solid arrow for all messages
    let arrow = '->>';
    diagram += `${from}${arrow}${to}: ${mermaidLabel}\n`;
  });
  return diagram;
}





const FlowSequenceDiagram = () => {
  const [events, setEvents] = useState([]);
  const [selectedEventIdx, setSelectedEventIdx] = useState(0);
  const [diagramKey, setDiagramKey] = useState(0);
  const [selectedFile, setSelectedFile] = useState(null);
  const diagramRef = useRef(null);

  // Handle file upload
  const handleFileChange = (e) => {
    const file = e.target.files[0];
    setSelectedFile(file || null);
    console.log('File selected:', file);
  };

  const handleLoad = () => {
    if (!selectedFile) {
      alert('No file selected.');
      return;
    }
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const raw = evt.target.result;
        const json = JSON.parse(raw);
        console.log('Raw JSON loaded:', json);
        let loadedEvents = [];
        if (Array.isArray(json.mergedTimeline)) {
          loadedEvents = json.mergedTimeline;
        } else if (Array.isArray(json.frontendEvents) || Array.isArray(json.backendEvents)) {
          loadedEvents = [
            ...(Array.isArray(json.frontendEvents) ? json.frontendEvents : []),
            ...(Array.isArray(json.backendEvents) ? json.backendEvents : [])
          ];
        } else if (Array.isArray(json.events)) {
          loadedEvents = json.events;
        } else if (Array.isArray(json)) {
          loadedEvents = json;
        } else if (json && typeof json === 'object') {
          // Try to find a property that is an array of objects
          const arrProp = Object.values(json).find(v => Array.isArray(v) && v.length && typeof v[0] === 'object');
          if (arrProp) loadedEvents = arrProp;
        }
        if (!Array.isArray(loadedEvents) || loadedEvents.length === 0) {
          alert('No events found in file. Check the file format.');
          console.warn('No events found after parsing:', json);
        }
        setEvents(loadedEvents);
        setSelectedEventIdx(0);
        setDiagramKey(prev => prev + 1);
        console.log('Loaded events:', loadedEvents);
      } catch (err) {
        alert('Invalid JSON file.');
        console.error('JSON parse error:', err);
      }
    };
    reader.readAsText(selectedFile);
  };

  useEffect(() => {
    if (diagramRef.current) {
      if (events.length === 0) {
        diagramRef.current.innerHTML = '';
        return;
      }
      // Debug: Log events before rendering
      console.log('Rendering diagram with events:', events.length, events);
      const diagram = generateMermaidSequence(events);
      mermaid.initialize({
        startOnLoad: false,
        theme: 'default',
        themeVariables: {
          actorFontWeight: 'bold',
          actorFontSize: '24px',
        },
        sequence: {
          actorMargin: 200,
          diagramPadding: 30,
        }
      });
      mermaid.render('mermaid-seq', diagram, (svgCode) => {
        diagramRef.current.innerHTML = svgCode;
        try {
          const svg = diagramRef.current.querySelector('svg');
          if (!svg) return;
          Array.from(svg.querySelectorAll('.event-overlay')).forEach(e => e.remove());
          const messageNodes = Array.from(svg.querySelectorAll('text.messageText'));
          let eventBlocks = [];
          let currentBlock = [];
          messageNodes.forEach((node, i) => {
            if (currentBlock.length === 0) {
              currentBlock.push(node);
            } else {
              const prevY = parseFloat(currentBlock[currentBlock.length - 1].getAttribute('y'));
              const currY = parseFloat(node.getAttribute('y'));
              if (currY - prevY > 25) {
                eventBlocks.push(currentBlock);
                currentBlock = [node];
              } else {
                currentBlock.push(node);
              }
            }
          });
          if (currentBlock.length > 0) eventBlocks.push(currentBlock);
          eventBlocks.forEach((block, idx) => {
            let group = null;
            if (block.length > 1) {
              group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
              block.forEach(node => group.appendChild(node.cloneNode(true)));
              svg.appendChild(group);
            }
            const bbox = (group || block[0]).getBBox();
            if (group) svg.removeChild(group);
            const minX = bbox.x - 12;
            const minY = bbox.y - 12;
            const width = bbox.width + 24;
            const height = bbox.height + 24;
            if (idx === selectedEventIdx) {
              const highlight = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
              highlight.setAttribute('x', minX);
              highlight.setAttribute('y', minY);
              highlight.setAttribute('width', width);
              highlight.setAttribute('height', height);
              highlight.setAttribute('fill', '#eaf3ff');
              highlight.setAttribute('stroke', '#0f62fe');
              highlight.setAttribute('stroke-width', '2');
              highlight.classList.add('event-overlay');
              block[0].parentNode.insertBefore(highlight, block[0]);
            }
            const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            rect.setAttribute('x', minX);
            rect.setAttribute('y', minY);
            rect.setAttribute('width', width);
            rect.setAttribute('height', height);
            rect.setAttribute('fill', 'rgba(144,238,144,0.25)');
            rect.setAttribute('cursor', 'pointer');
            rect.setAttribute('pointer-events', 'all');
            rect.setAttribute('title', 'Click to select event');
            rect.classList.add('event-overlay');
            rect.addEventListener('click', (e) => { e.stopPropagation(); setSelectedEventIdx(idx); });
            block[0].parentNode.insertBefore(rect, block[0]);
          });
        } catch (e) {}
      });
    }
  }, [events, selectedEventIdx]);



  // Export as HTML
  function handleExportHTML() {
    if (!diagramRef.current) return;
    const svg = diagramRef.current.innerHTML;
    const html = `<!DOCTYPE html><html><head><meta charset='utf-8'><title>Sequence Diagram Export</title></head><body style='background:#fff;'>${svg}</body></html>`;
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sequence-diagram-export.html';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
  }

  // Export as PNG
  function handleExportPNG() {
    if (!diagramRef.current) return;
    const svgElem = diagramRef.current.querySelector('svg');
    if (!svgElem) return;
    const svgString = new XMLSerializer().serializeToString(svgElem);
    const canvas = document.createElement('canvas');
    const bbox = svgElem.getBBox();
    canvas.width = bbox.width + 40;
    canvas.height = bbox.height + 40;
    const ctx = canvas.getContext('2d');
    const img = new window.Image();
    const svg64 = btoa(unescape(encodeURIComponent(svgString)));
    const image64 = 'data:image/svg+xml;base64,' + svg64;
    img.onload = function () {
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 20, 20);
      canvas.toBlob(function(blob) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'sequence-diagram-export.png';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
      }, 'image/png');
    };
    img.src = image64;
  }

  // Helper to pretty-print JSON
  function pretty(obj) {
    return JSON.stringify(obj, null, 2);
  }

  const selectedEvent = events[selectedEventIdx] || null;

  // Generate a one-line, human-readable description for a key/value
  function fieldDescription(key, value) {
  // ── Challenge ──────────────────────────────────────────────────────────────
  if (key === 'challenge') {
    return 'A unique random string generated fresh by the server for every login or registration attempt. ' +
      'Your passkey will cryptographically "sign" this challenge to prove it holds the real secret key. ' +
      'Because a new challenge is created each time, an attacker who intercepts a previous login ' +
      'cannot reuse it — this is called replay-attack prevention.';
  }

  // ── Allow / Exclude Credentials ────────────────────────────────────────────
  if (key === 'allowCredentials') {
    return `A list of passkeys the server will accept for this login. Each entry contains a credential ` +
      `ID and the transport methods (USB, internal chip, Bluetooth, etc.) the server knows that ` +
      `passkey can use. Your browser/device uses this list to find the right passkey without ` +
      `exposing others. ${Array.isArray(value) ? `(${value.length} credential${value.length !== 1 ? 's' : ''} listed)` : ''}`;
  }
  if (key === 'excludeCredentials') {
    return `A list of passkeys already registered for this account. During registration the server ` +
      `sends this list so your device won't create a duplicate passkey for a device you've ` +
      `already enrolled. ${Array.isArray(value) ? `(${value.length} existing credential${value.length !== 1 ? 's' : ''})` : ''}`;
  }

  // ── Credential type & id ───────────────────────────────────────────────────
  if (key === 'type') {
    if (value === 'public-key') {
      return '"public-key" is the only WebAuthn credential type. It means the passkey stores a ' +
        'private key on your device and shares only the corresponding public key with the server — ' +
        'so the server can verify you without ever seeing your secret.';
    }
    return `Type: ${value}`;
  }
  if (key === 'id') {
    return 'A stable identifier the server assigned to this specific passkey when it was created. ' +
      'It is not a secret — it just tells the server which public key to use when verifying your ' +
      'signature. Think of it like a username for a single passkey.';
  }
  if (key === 'rawId') {
    return 'The same credential ID as "id" but in its original binary (Base64-encoded) form before ' +
      'any URL-safe encoding is applied. Included alongside "id" to ensure nothing is lost in ' +
      'encoding conversion.';
  }

  // ── Transports ─────────────────────────────────────────────────────────────
  if (key === 'transports') {
    const transportLabels = {
      internal: 'a built-in authenticator (fingerprint sensor, Face ID, or Windows Hello)',
      usb:      'a USB security key (e.g. YubiKey)',
      nfc:      'an NFC tap (tap the key or phone to a reader)',
      ble:      'Bluetooth (phone or BLE security key nearby)',
      hybrid:   'cross-device (scanning a QR code on another phone)',
      'smart-card': 'a smart card reader',
    };
    const labels = (Array.isArray(value) ? value : [value])
      .map(t => transportLabels[t] || t)
      .join(', ');
    return `How the passkey communicates with the browser: ${labels}. The browser uses this hint to ` +
      `choose the right UI (e.g. show a fingerprint prompt vs. a QR code).`;
  }

  // ── User verification ──────────────────────────────────────────────────────
  if (key === 'userVerification') {
    const meanings = {
      required:    '"required" means the server insists on a local check — fingerprint, face scan, or PIN — before the passkey is used. If the device cannot perform verification, the request will fail.',
      preferred:   '"preferred" means perform a fingerprint/PIN check if the device supports it, but don\'t block the flow if it doesn\'t.',
      discouraged: '"discouraged" means skip the local check entirely — just presence of the device is enough (used for low-risk operations like adding a second factor, not primary login).',
    };
    return meanings[value] || `User verification requirement: ${value}.`;
  }

  // ── Timeout ────────────────────────────────────────────────────────────────
  if (key === 'timeout') {
    const secs = typeof value === 'number' ? Math.round(value / 1000) : '?';
    return `How long (${secs} seconds) the browser will wait for you to complete the passkey gesture ` +
      `(fingerprint tap, PIN entry, etc.) before giving up and showing an error. Set by the server ` +
      `to balance security and usability.`;
  }

  // ── Relying party ──────────────────────────────────────────────────────────
  if (key === 'rpId') {
    return `The "Relying Party ID" — the domain name this passkey is bound to (value: "${value}"). ` +
      `Passkeys are cryptographically tied to this domain, so a passkey created for example.com ` +
      `cannot be used on evil-example.com. This is the core anti-phishing guarantee of WebAuthn.`;
  }
  if (key === 'rp') {
    return 'Information about the website (Relying Party) the passkey is being registered for. ' +
      'Contains the domain "id" and a human-readable "name". The browser shows this name to users ' +
      'in prompts like "Create a passkey for Acme Corp?".';
  }

  // ── User ───────────────────────────────────────────────────────────────────
  if (key === 'user') {
    return 'Identifies the account being enrolled. Contains three sub-fields: "id" (an opaque byte ' +
      'string your server uses to link the passkey to an account), "name" (usually the email shown ' +
      'in authenticator UI), and "displayName" (a friendly label like "Jane Smith").';
  }
  if (key === 'username') {
    return `The account identifier (email or username) submitted by the user to start this flow. ` +
      `The server uses it to look up any existing passkeys and build the challenge. ` +
      `Value: "${value}"`;
  }
  if (key === 'displayName') {
    return `A human-readable label for the account shown inside the passkey prompt on the ` +
      `device (e.g. "Jane Smith"). It helps users identify which passkey to approve when they ` +
      `have multiple accounts on a site. Value: "${value}"`;
  }

  // ── Crypto: assertion response fields ─────────────────────────────────────
  if (key === 'authenticatorData') {
    return 'A binary blob (Base64-encoded here) produced by the authenticator chip/OS. It contains: ' +
      'the hash of the rpId (proving which site was used), a flags byte (bit 0 = user was present, ' +
      'bit 2 = user was verified), a counter that increments with every use (so the server can ' +
      'detect cloned authenticators), and optional extension data. The server checks all of these ' +
      'before accepting the login.';
  }
  if (key === 'clientDataJSON') {
    return 'A Base64-encoded JSON object assembled by the browser (not the authenticator). It ' +
      'records the operation type ("webauthn.get" for login, "webauthn.create" for registration), ' +
      'the exact challenge the server sent, and the page origin. The authenticator signs this ' +
      'alongside authenticatorData, so any tampering is detected.';
  }
  if (key === 'signature') {
    return 'The cryptographic proof of this login. The passkey\'s private key signed a combination ' +
      'of authenticatorData + a hash of clientDataJSON. The server verifies this signature with ' +
      'the stored public key — if the signature is valid, it proves you hold the private key ' +
      'without the server ever seeing it.';
  }
  if (key === 'userHandle') {
    return 'An opaque byte string (Base64-encoded) returned by the authenticator that links the ' +
      'passkey to an account on the server. In "username-less" / discoverable credential flows the ' +
      'server uses this to look up which user logged in, since no username was typed. It is set ' +
      'during registration and should NOT contain PII (not an email or name).';
  }

  // ── Crypto: attestation (registration) ────────────────────────────────────
  if (key === 'attestationObject') {
    return 'A CBOR-encoded object returned only during registration. It bundles three things: ' +
      '(1) the new public key itself, (2) authenticatorData (same structure as in login), and ' +
      '(3) an optional attestation statement — a certificate chain proving which make/model of ' +
      'authenticator created the key, useful for high-security scenarios. Most consumer sites ' +
      'use "none" attestation and ignore the certificate.';
  }
  if (key === 'publicKey') {
    return 'The public half of the passkey\'s key pair (COSE-encoded). The server stores this ' +
      'permanently. It can only verify signatures — it cannot be used to log in by itself or to ' +
      'recover the private key. Think of it like a padlock the server keeps; only your device ' +
      'holds the matching key.';
  }
  if (key === 'publicKeyAlgorithm') {
    const algNames = { '-7': 'ES256 (ECDSA with SHA-256)', '-257': 'RS256 (RSASSA-PKCS1-v1_5 with SHA-256)', '-8': 'EdDSA (Ed25519)' };
    const name = algNames[String(value)] || `algorithm ID ${value}`;
    return `The signing algorithm used by this passkey: ${name}. This tells the server how to ` +
      `verify signatures. ES256 (the most common) uses elliptic-curve cryptography, which is ` +
      `fast and produces compact signatures.`;
  }

  // ── Counter fields ─────────────────────────────────────────────────────────
  if (key === 'verified') {
    return value === true
      ? 'The server successfully verified the passkey signature, confirmed the challenge matched, ' +
        'checked the origin, and accepted the counter. Authentication passed.'
      : 'Verification failed — the server rejected the passkey response. Possible causes: wrong ' +
        'challenge, mismatched origin, invalid signature, or a counter regression (potential clone).';
  }
  if (key === 'storedCounter') {
    return `The sign-count the server had stored from the previous successful use of this passkey ` +
      `(value: ${value}). WebAuthn authenticators increment a counter on every use to help detect ` +
      `cloned credentials.`;
  }
  if (key === 'reportedCounter') {
    return `The sign-count value the authenticator reported in this response (value: ${value}). ` +
      `The server compares this to the stored counter to verify it has not gone backwards, which ` +
      `would suggest the passkey was copied to another device.`;
  }
  if (key === 'nextCounter') {
    return `The value (${value}) the server will now store as the new sign-count for this passkey. ` +
      `On the next login the reported counter must be ≥ this value, or the server flags a ` +
      `potential clone attack.`;
  }
  if (key === 'counterDidRegress') {
    return value === false
      ? 'The sign-count did not go backwards — no clone detected. Counter validation passed.'
      : 'The counter regressed (new value < stored value). This can indicate the passkey was ' +
        'cloned to another device. High-security apps may reject or flag this login.';
  }

  // ── Misc response fields ───────────────────────────────────────────────────
  if (key === 'success') {
    return value === true
      ? 'The server completed the operation successfully and considers the user authenticated.'
      : 'The server returned a failure response. Check earlier events for the specific error.';
  }
  if (key === 'hasResponse') {
    return value === true
      ? 'The browser\'s navigator.credentials.get() call returned a credential object — the user ' +
        'completed the passkey gesture (fingerprint, PIN, etc.) successfully.'
      : 'No credential was returned — the user may have cancelled or the authenticator was unavailable.';
  }
  if (key === 'hasAssertion') {
    return value === true
      ? 'The backend received the signed assertion from the frontend and is ready to verify it.'
      : 'No assertion was received by the backend.';
  }
  if (key === 'assertion') {
    return 'The full signed response from the user\'s authenticator, sent to the server for ' +
      'verification. Contains the credential ID, the signed authenticatorData, clientDataJSON, ' +
      'the signature, and optionally the userHandle. This is the "proof of possession" of the passkey.';
  }
  if (key === 'origin') {
    return `The full URL origin (scheme + host + port) of the page that initiated this WebAuthn ` +
      `operation (value: "${value}"). The authenticator signs this into clientDataJSON. The server ` +
      `checks it matches the expected origin — a mismatch means a phishing page tried to relay ` +
      `the request.`;
  }
  if (key === 'crossOrigin') {
    return value === false
      ? '"crossOrigin: false" means the credential was created on the same origin as the page — ' +
        'the normal case. A cross-origin value of true would mean an iframe on a different domain ' +
        'initiated the ceremony, which most servers reject.'
      : 'The WebAuthn ceremony was initiated from a different origin (cross-origin iframe). ' +
        'Servers typically reject this unless explicitly configured to allow it.';
  }
  if (key === 'email') {
    return `The email address submitted by the user to identify their account (value: "${value}"). ` +
      `Used by the server to look up registered passkeys and build the authentication challenge.`;
  }

  // ── PubKeyCredParams (registration) ───────────────────────────────────────
  if (key === 'pubKeyCredParams') {
    return `An ordered list of cryptographic algorithms the server is willing to accept for the ` +
      `new passkey. The device picks the first algorithm it supports. ` +
      `${Array.isArray(value) ? `(${value.length} algorithm${value.length !== 1 ? 's' : ''} offered)` : ''}`;
  }
  if (key === 'alg') {
    const algNames = { '-7': 'ES256 (ECDSA/P-256)', '-257': 'RS256 (RSA/PKCS1)', '-8': 'EdDSA (Ed25519)' };
    return `Algorithm code ${value} = ${algNames[String(value)] || 'unknown algorithm'}. ` +
      `This integer is defined by the COSE standard (RFC 8152).`;
  }

  // ── Authenticator selection (registration) ─────────────────────────────────
  if (key === 'authenticatorSelection') {
    return 'Constraints the server places on which type of authenticator can be used to register. ' +
      'Sub-fields like "authenticatorAttachment", "residentKey", and "userVerification" let the ' +
      'server require, for example, a built-in device sensor (not a USB key) and that the passkey ' +
      'be stored on the device for username-less login.';
  }
  if (key === 'authenticatorAttachment') {
    const meanings = {
      platform:      '"platform" — only accept a built-in authenticator (Face ID, fingerprint sensor, Windows Hello). No USB or Bluetooth keys.',
      'cross-platform': '"cross-platform" — only accept a roaming authenticator such as a hardware security key (YubiKey, etc.).',
    };
    return meanings[value] || `Authenticator attachment preference: ${value}.`;
  }
  if (key === 'residentKey') {
    const meanings = {
      required:    '"required" — the passkey must be stored on the authenticator as a discoverable credential. This enables username-less login (the server never asks for an email).',
      preferred:   '"preferred" — store as discoverable if possible, fall back to non-discoverable.',
      discouraged: '"discouraged" — do not store on the authenticator; the server will pass a credential ID at login time.',
    };
    return meanings[value] || `Resident key requirement: ${value}.`;
  }

  // ── Attestation conveyance ─────────────────────────────────────────────────
  if (key === 'attestation') {
    const meanings = {
      none:     '"none" — the server does not need a certificate proving what type of authenticator was used. Simplest and most privacy-preserving option; fine for most consumer apps.',
      indirect: '"indirect" — the server wants attestation but allows the browser to anonymise it.',
      direct:   '"direct" — the server wants the raw attestation certificate so it can verify the exact make/model of authenticator.',
      enterprise: '"enterprise" — the server wants unique device identifiers, used in corporate MDM scenarios.',
    };
    return meanings[value] || `Attestation conveyance preference: ${value}.`;
  }

  // ── Extensions ────────────────────────────────────────────────────────────
  if (key === 'extensions') {
    return 'Optional WebAuthn extensions that add extra capabilities or metadata to the ceremony. ' +
      'Common examples: "credProps" (tells the client whether a resident/discoverable key was ' +
      'created), "uvm" (user verification method — reports biometric vs PIN), "prf" (lets the ' +
      'passkey derive a symmetric key for encryption use cases).';
  }

  // ── Generic fallbacks ─────────────────────────────────────────────────────
  if (Array.isArray(value)) return `Array with ${value.length} item${value.length !== 1 ? 's' : ''}.`;
  if (typeof value === 'object' && value !== null) return 'Nested object — expand to see sub-fields.';
  return '';
}

  // Recursively generate a flat, readable list for the payload (unlimited depth)
  function describePayload(payload) {
    if (!payload || typeof payload !== 'object') return <div>No payload.</div>;
    let desc = [];
    // (Removed: special case for counter note; now handled in annotation only)
    if (Array.isArray(payload)) {
      if (payload.length === 0) return <div>[empty array]</div>;
      payload.forEach((item, idx) => {
        desc.push(
          <div key={idx} style={{ marginBottom: 8 }}>
            <span style={{ fontWeight: 500, color: '#333' }}>{`[${idx}]`}</span>
            <div style={{ fontFamily: 'monospace', color: '#222', marginTop: 2 }}>{typeof item === 'object' ? '' : String(item)}</div>
            <div style={{ fontFamily: 'cursive', color: '#8a6d00', fontSize: 14, marginBottom: 2 }}>{fieldDescription(idx, item)}</div>
            {typeof item === 'object' && item !== null ? describePayload(item) : null}
          </div>
        );
      });
      return <div>{desc}</div>;
    }
    for (const [key, value] of Object.entries(payload)) {
      desc.push(
        <div key={key + '-field'} style={{ marginBottom: 8 }}>
          <span style={{ fontWeight: 500, color: '#333' }}>{key}:</span>
          <span style={{ fontFamily: 'monospace', color: '#222', marginLeft: 6 }}>{typeof value === 'object' ? '' : String(value)}</span>
          <div style={{ fontFamily: 'cursive', color: '#8a6d00', fontSize: 14, marginTop: 2, marginBottom: 2 }}>{fieldDescription(key, value)}</div>
          {typeof value === 'object' && value !== null ? describePayload(value) : null}
        </div>
      );
    }
    return <div>{desc}</div>;
  }

  return (
    <div style={{ maxWidth: '1100px', margin: '24px auto', padding: '0 16px', display: 'flex', gap: '32px' }}>
      <div style={{ flex: 2, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h1 style={{ marginBottom: 0 }}>Passkey Flow Sequence Diagram</h1>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 16 }}>
          <input type="file" accept="application/json" onChange={handleFileChange} style={{ marginLeft: 0 }} />
          <button type="button" onClick={handleLoad} style={{ padding: '8px 16px', borderRadius: 4, border: '1px solid #0f62fe', background: '#eaf3ff', fontWeight: 600, cursor: 'pointer' }}>Load</button>
        </div>
        <div
          key={diagramKey}
          ref={diagramRef}
          style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: '8px', padding: '24px', overflowX: 'auto', marginTop: 16 }}
        />
      </div>
      {/* Right-side card for selected event */}
      <div style={{ flex: 1.3, minWidth: 400, maxWidth: 600, background: '#f8fafd', border: '1px solid #e0e0e0', borderRadius: 10, padding: '24px 24px', marginTop: 48, height: 'fit-content' }}>
        <h2 style={{ fontSize: 20, marginBottom: 12 }}>Event Details</h2>
        {selectedEvent ? (
          <div>
            <div style={{ marginBottom: 10 }}>
              <b>Step / Type:</b> {selectedEvent.step || selectedEvent.endpoint || selectedEvent.type || 'event'}
            </div>
            <div style={{ marginBottom: 10 }}>
              <b>From:</b> {(() => {
                if (selectedEvent.direction === 'frontend->backend' || selectedEvent.source === 'frontend') return 'Frontend';
                if (selectedEvent.direction === 'backend->frontend' || selectedEvent.source === 'backend') return 'Backend';
                if (selectedEvent.direction === 'browser->frontend') return 'Browser';
                if (selectedEvent.direction === 'frontend->browser') return 'Frontend';
                if (!selectedEvent.direction && selectedEvent.source === 'frontend' && selectedEvent.step && selectedEvent.step.toLowerCase().includes('browser')) return 'Browser';
                return 'Frontend';
              })()}
            </div>
            <div style={{ marginBottom: 10 }}>
              <b>To:</b> {(() => {
                if (selectedEvent.direction === 'frontend->backend' || selectedEvent.source === 'frontend') return 'Backend';
                if (selectedEvent.direction === 'backend->frontend' || selectedEvent.source === 'backend') return 'Frontend';
                if (selectedEvent.direction === 'browser->frontend') return 'Frontend';
                if (selectedEvent.direction === 'frontend->browser') return 'Browser';
                if (!selectedEvent.direction && selectedEvent.source === 'frontend' && selectedEvent.step && selectedEvent.step.toLowerCase().includes('browser')) return 'Frontend';
                return 'Backend';
              })()}
            </div>
            <div style={{ marginBottom: 10 }}>
              <b>Timestamp:</b> {selectedEvent.timestamp ? new Date(selectedEvent.timestamp).toLocaleString() : ''}
            </div>
            {selectedEvent && (() => {
              const derived = generateAnnotations(selectedEvent);
              // Remove annotation items whose label matches a payload key or is already described in the breakdown
              const payloadKeys = selectedEvent && selectedEvent.payloadRaw && typeof selectedEvent.payloadRaw === 'object'
                ? new Set(Object.keys(selectedEvent.payloadRaw).map(k => k.toLowerCase()))
                : new Set();
              // Also filter out annotation labels that are substrings of payload keys (for array/compound fields)
              const filtered = derived.filter(ann => {
                const label = ann.label.toLowerCase();
                // Remove if label is a payload key or is contained in any payload key
                if (payloadKeys.has(label)) return false;
                for (const k of payloadKeys) {
                  if (k.includes(label) || label.includes(k)) return false;
                }
                // Remove if label is a common field described in fieldDescription
                const commonFields = [
                  'challenge', 'allowcredentials', 'excludecredentials', 'type', 'id', 'rawid', 'transports',
                  'userverification', 'timeout', 'rpid', 'rp', 'user', 'username', 'displayname',
                  'authenticatordata', 'clientdatajson', 'signature', 'userhandle', 'attestationobject',
                  'publickey', 'publickeyalgorithm', 'verified', 'storedcounter', 'reportedcounter',
                  'nextcounter', 'counterdidregress', 'success', 'hasresponse', 'hasassertion', 'assertion',
                  'origin', 'crossorigin', 'email', 'pubkeycredparams', 'alg', 'authenticatorselection',
                  'authenticatorattachment', 'residentkey', 'attestation', 'extensions'
                ];
                if (commonFields.includes(label.replace(/\s/g, '').toLowerCase())) return false;
                return true;
              });
              return (
                <div style={{ marginBottom: 10 }}>
                  <b>Summary</b>
                  <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {filtered.length === 0 ? (
                      <span style={{ color: '#888', fontSize: 13 }}>No additional summary for this event.</span>
                    ) : filtered.map((ann, i) => {
                      const s = TYPE_STYLES[ann.type] || TYPE_STYLES.info;
                      return (
                        <div key={i} style={{
                          border: s.border,
                          background: s.background,
                          borderRadius: 6,
                          padding: '8px 10px',
                          fontSize: 13,
                          display: 'flex', alignItems: 'center', gap: 8
                        }}>
                          <span style={{
                            width: 8, height: 8, borderRadius: '50%',
                            background: s.dot, flexShrink: 0, display: 'inline-block',
                          }}/>
                          <span style={{ fontWeight: 600, color: s.labelColor, fontSize: 12, marginRight: 8 }}>
                            {ann.label}
                          </span>
                          <span style={{ color: '#333', lineHeight: 1.5 }}>{ann.detail}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
            <div style={{ marginBottom: 10 }}>
              <b>Raw Payload:</b>
              <pre style={{ margin: 0, background: '#121212', color: '#e7e7e7', fontSize: '12px', lineHeight: '1.5', padding: '10px', borderRadius: '6px', overflowX: 'auto' }}>
                {selectedEvent.payloadRaw ? pretty(selectedEvent.payloadRaw) : 'None'}
              </pre>
            </div>
            <div style={{ marginBottom: 10 }}>
              <b>Payload Breakdown:</b>
              <div style={{ background: '#f3f3f3', borderRadius: 4, padding: 8, fontSize: 14, margin: 0, wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>
                {selectedEvent.payloadRaw ? describePayload(selectedEvent.payloadRaw) : 'None'}
              </div>
            </div>
          </div>
        ) : (
          <div>No event selected.</div>
        )}
      </div>
    </div>
  );
};

export default FlowSequenceDiagram;
