import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

const FLOW_EVENT_UPDATED = 'passkey-flow-updated';
const apiBase = (process.env.REACT_APP_API_BASE_URL || '').replace(/\/$/, '');
const apiUrl = (path) => `${apiBase}${path}`;
const FLOW_EVENTS_STORAGE_KEY = 'passkeyFlowEvents';
const FLOW_EVENTS_TTL_MS = 5 * 60 * 1000;
const FLOW_EVENTS_CHANNEL_NAME = 'passkey-flow-events';

let flowEventsChannel;

const getFlowEventsChannel = () => {
  if (typeof window === 'undefined' || !('BroadcastChannel' in window)) {
    return null;
  }

  if (!flowEventsChannel) {
    flowEventsChannel = new BroadcastChannel(FLOW_EVENTS_CHANNEL_NAME);
  }

  return flowEventsChannel;
};

const broadcastFlowEvents = (events) => {
  const channel = getFlowEventsChannel();
  if (!channel) {
    return;
  }

  channel.postMessage({
    type: 'flow-events-updated',
    events,
    sentAt: new Date().toISOString(),
  });
};

const pruneExpiredFlowEvents = (events) => {
  const cutoff = Date.now() - FLOW_EVENTS_TTL_MS;
  return (events || []).filter((event) => {
    const timestamp = new Date(event?.timestamp || 0).getTime();
    if (Number.isNaN(timestamp)) {
      return false;
    }
    return timestamp >= cutoff;
  });
};

const loadPersistedFlowEvents = () => {
  try {
    const raw = window.localStorage.getItem(FLOW_EVENTS_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return pruneExpiredFlowEvents(parsed);
    }

    if (parsed && Array.isArray(parsed.events)) {
      return pruneExpiredFlowEvents(parsed.events);
    }

    return [];
  } catch (error) {
    return [];
  }
};

const persistFlowEvents = (events) => {
  try {
    const pruned = pruneExpiredFlowEvents(events);
    window.localStorage.setItem(FLOW_EVENTS_STORAGE_KEY, JSON.stringify({
      savedAt: new Date().toISOString(),
      ttlMs: FLOW_EVENTS_TTL_MS,
      events: pruned,
    }));
  } catch (error) {
    // Ignore localStorage write failures in private or restricted contexts.
  }
};

const decodeBase64ToBytes = (value) => {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }

  const sanitized = value.replace(/\s+/g, '');
  const normalized = sanitized.replace(/-/g, '+').replace(/_/g, '/');
  const padLength = normalized.length % 4;
  const padded = padLength === 0 ? normalized : `${normalized}${'='.repeat(4 - padLength)}`;

  try {
    const binary = window.atob(padded);
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch (error) {
    return null;
  }
};

const bytesToHex = (bytes) => {
  if (!bytes) {
    return '';
  }

  return Array.from(bytes)
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
};

const bytesToUtf8 = (bytes) => {
  if (!bytes) {
    return '';
  }

  try {
    return new TextDecoder('utf-8').decode(bytes);
  } catch (error) {
    return '';
  }
};

const parseAuthenticatorData = (encodedValue) => {
  const bytes = decodeBase64ToBytes(encodedValue);
  if (!bytes || bytes.length < 37) {
    return null;
  }

  const flags = bytes[32];
  const dataView = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const signCount = dataView.getUint32(33, false);

  return {
    byteLength: bytes.length,
    rpIdHashHex: bytesToHex(bytes.slice(0, 32)),
    flags: {
      userPresent: Boolean(flags & 0x01),
      userVerified: Boolean(flags & 0x04),
      backupEligible: Boolean(flags & 0x08),
      backupState: Boolean(flags & 0x10),
      attestedCredentialDataIncluded: Boolean(flags & 0x40),
      extensionDataIncluded: Boolean(flags & 0x80),
    },
    signCount,
  };
};

const parseClientDataJson = (encodedValue) => {
  const bytes = decodeBase64ToBytes(encodedValue);
  if (!bytes) {
    return null;
  }

  const text = bytesToUtf8(bytes);
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    return null;
  }
};

const IDENTITY_KEYS = ['email', 'phone', 'username', 'user', 'name'];

const getValueAtPath = (obj, path) => {
  const parts = path.split('.');
  let cursor = obj;
  for (let i = 0; i < parts.length; i += 1) {
    if (!cursor || typeof cursor !== 'object' || !(parts[i] in cursor)) {
      return undefined;
    }
    cursor = cursor[parts[i]];
  }
  return cursor;
};

const findFirstField = (payload, paths) => {
  for (let i = 0; i < paths.length; i += 1) {
    const path = paths[i];
    const value = getValueAtPath(payload, path);
    if (value !== undefined && value !== null) {
      return { value, path };
    }
  }
  return null;
};

const decodeFlowPayload = (event) => {
  const payload = event?.payloadRaw;
  if (!payload || typeof payload !== 'object') {
    return {
      shouldShowDecoded: false,
      hiddenReason: 'No structured WebAuthn payload in this event.',
      fieldCards: [],
      annotations: [],
      conversions: [],
    };
  }

  const decoded = {
    shouldShowDecoded: true,
    hiddenReason: '',
    fieldCards: [],
    annotations: [],
    conversions: [],
  };


  // Recursively enumerate all fields and subfields, with explanations
  const explainedFields = new Set();
  const addFieldCard = (label, value, why) => {
    decoded.fieldCards.push({ label, value, why });
    explainedFields.add(label);
  };

  // Helper to explain a field based on its path/key
  const explainField = (label, value) => {
    // Custom explanations for known fields
    if (label === 'challenge') return 'Server nonce that prevents replay attacks.';
    if (label === 'rp.name') return 'Relying party (site) name shown to user.';
    if (label === 'rp.id') return 'Relying party ID (domain) checked by authenticator.';
    if (label === 'user.id') return 'User ID (base64url, usually random bytes, not email).';
    if (label === 'user.name') return 'User name (usually email or username).';
    if (label === 'user.displayName') return 'User display name (friendly label).';
    if (label.startsWith('pubKeyCredParams[') && label.endsWith('].type')) return 'Credential type (should be public-key).';
    if (label.startsWith('pubKeyCredParams[') && label.endsWith('].alg')) return 'COSE algorithm identifier for credential.';
    if (label === 'authenticatorSelection.authenticatorAttachment') return '"platform" = device built-in, "cross-platform" = security key.';
    if (label === 'authenticatorSelection.residentKey') return '"required" means credential must be discoverable on authenticator.';
    if (label === 'authenticatorSelection.userVerification') return '"required" means biometric/PIN verification needed.';
    if (label === 'attestation') return 'Attestation conveys device provenance. "direct" = send attestation, "none" = skip.';
    // Generic explanations
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) return 'Object with subfields.';
    if (Array.isArray(value)) return 'Array of values.';
    return 'Field from WebAuthn registration options.';
  };

  // Recursive function to enumerate all fields
  const enumerateFields = (obj, prefix = '') => {
    if (typeof obj !== 'object' || obj === null) return;
    if (Array.isArray(obj)) {
      obj.forEach((item, idx) => {
        enumerateFields(item, `${prefix}[${idx}]`);
      });
      return;
    }
    Object.entries(obj).forEach(([key, value]) => {
      const label = prefix ? `${prefix}.${key}` : key;
      if (!explainedFields.has(label)) {
        addFieldCard(label, value, explainField(label, value));
      }
      if (typeof value === 'object' && value !== null) {
        enumerateFields(value, label);
      }
    });
  };

  // Call recursive enumerator for the payload
  enumerateFields(payload);



  // Remove explicit per-field logic; rely solely on recursive enumeration above.
  // Optionally, you can keep the identityOnly/hiddenReason logic if you want to hide decoded view for identity-only payloads:
  const payloadKeys = Object.keys(payload);
  const identityOnly = payloadKeys.length > 0 && payloadKeys.every((key) => IDENTITY_KEYS.includes(key));
  if (!decoded.fieldCards.length && identityOnly) {
    decoded.shouldShowDecoded = false;
    decoded.hiddenReason = 'This step only carries account identity input before WebAuthn fields appear.';
  }
  if (!decoded.fieldCards.length && !identityOnly) {
    decoded.shouldShowDecoded = false;
    decoded.hiddenReason = 'No WebAuthn-specific fields detected for this event.';
  }

  return decoded;
};

function FlowInspectorPanel() {
  const navigate = useNavigate();
  const [flowEvents, setFlowEvents] = useState(window.__passkeyFlowEvents || loadPersistedFlowEvents());
  const [backendEventsByTrace, setBackendEventsByTrace] = useState({});
  const [expandedRows, setExpandedRows] = useState({});
  const [backendTraceError, setBackendTraceError] = useState('');

  const clearStoredTraces = () => {
    window.__passkeyFlowEvents = [];
    setFlowEvents([]);
    setExpandedRows({});
    persistFlowEvents([]);
    window.dispatchEvent(new Event(FLOW_EVENT_UPDATED));
    broadcastFlowEvents([]);
  };

  useEffect(() => {
    const syncEvents = () => {
      const nextEvents = window.__passkeyFlowEvents || loadPersistedFlowEvents();
      const pruned = pruneExpiredFlowEvents(nextEvents || []);
      setFlowEvents([...pruned]);
      if (window.__passkeyFlowEvents !== pruned) {
        window.__passkeyFlowEvents = pruned;
      }
      persistFlowEvents(pruned);
    };

    const handleStorage = (event) => {
      if (event.key === FLOW_EVENTS_STORAGE_KEY) {
        syncEvents();
      }
    };

    const handleChannelMessage = (event) => {
      if (event?.data?.type !== 'flow-events-updated') {
        return;
      }

      const incomingEvents = pruneExpiredFlowEvents(event.data.events || []);
      window.__passkeyFlowEvents = incomingEvents;
      persistFlowEvents(incomingEvents);
      setFlowEvents([...incomingEvents]);
    };

    const channel = getFlowEventsChannel();

    syncEvents();
    window.addEventListener(FLOW_EVENT_UPDATED, syncEvents);
    window.addEventListener('storage', handleStorage);
    if (channel) {
      channel.addEventListener('message', handleChannelMessage);
    }

    return () => {
      window.removeEventListener(FLOW_EVENT_UPDATED, syncEvents);
      window.removeEventListener('storage', handleStorage);
      if (channel) {
        channel.removeEventListener('message', handleChannelMessage);
      }
    };
  }, []);

  const latestTraceId = useMemo(() => {
    for (let i = flowEvents.length - 1; i >= 0; i -= 1) {
      if (flowEvents[i]?.traceId) {
        return flowEvents[i].traceId;
      }
    }
    return '';
  }, [flowEvents]);

  useEffect(() => {
    if (!latestTraceId) {
      return undefined;
    }

    let active = true;

    const fetchBackendTrace = async () => {
      try {
        const response = await axios.get(apiUrl(`/webauthn/trace/${encodeURIComponent(latestTraceId)}`));
        if (!active) {
          return;
        }

        const events = Array.isArray(response.data?.events) ? response.data.events : [];
        setBackendEventsByTrace((previous) => ({
          ...previous,
          [latestTraceId]: events,
        }));
        setBackendTraceError('');
      } catch (fetchError) {
        if (!active) {
          return;
        }

        if (fetchError.response?.status === 429) {
          setBackendTraceError('Trace polling rate-limited (429). This is expected during heavy local testing.');
          return;
        }

        if (fetchError.response?.status === 404) {
          return;
        }

        setBackendTraceError(fetchError.message || 'Unable to fetch backend trace events');
      }
    };

    fetchBackendTrace();
    const intervalId = setInterval(fetchBackendTrace, 2000);

    return () => {
      active = false;
      clearInterval(intervalId);
    };
  }, [latestTraceId]);

  const mergedTimeline = useMemo(() => {
    const frontend = flowEvents.map((event, index) => ({
      ...event,
      uiId: `frontend-${index}-${event.timestamp}`,
      source: event.source || 'frontend',
    }));

    const backend = (backendEventsByTrace[latestTraceId] || []).map((event, index) => ({
      ...event,
      traceId: latestTraceId,
      uiId: `backend-${index}-${event.timestamp}`,
      source: event.source || 'backend',
    }));

    return [...frontend, ...backend].sort((a, b) => {
      const aTime = new Date(a.timestamp || 0).getTime();
      const bTime = new Date(b.timestamp || 0).getTime();
      return aTime - bTime;
    });
  }, [flowEvents, backendEventsByTrace, latestTraceId]);

  const toggleExpanded = (uiId) => {
    setExpandedRows((previous) => ({
      ...previous,
      [uiId]: !previous[uiId],
    }));
  };

  const copyPayload = async (payload) => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(payload || {}, null, 2));
    } catch (copyError) {
      console.error('Copy failed:', copyError);
    }
  };

  const formatTime = (value) => {
    if (!value) {
      return '--:--:--';
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }
    return date.toLocaleTimeString();
  };

  return (
    <div style={{
      padding: '20px',
      borderRadius: '10px',
      boxShadow: '0 2px 10px rgba(0, 0, 0, 0.1)',
      background: '#fff',
      textAlign: 'left',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', gap: '8px' }}>
        <h2 style={{ margin: 0, fontSize: '20px' }}>Passkey Flow Inspector</h2>
        <button
          type="button"
          onClick={clearStoredTraces}
          style={{
            border: '1px solid #d0d0d0',
            background: '#fafafa',
            borderRadius: '4px',
            padding: '6px 10px',
            cursor: 'pointer',
          }}
        >
          Clear View
        </button>
      </div>

      <p style={{ marginTop: 0, marginBottom: '10px', color: '#444', fontSize: '14px' }}>
        Latest trace: {latestTraceId || 'none'}
      </p>

      <button
        type="button"
        onClick={() => window.open('/flow-inspector', '_blank', 'noopener,noreferrer')}
        style={{
          border: '1px solid #d0d0d0',
          background: '#fff',
          borderRadius: '4px',
          padding: '6px 10px',
          cursor: 'pointer',
          marginBottom: '10px',
        }}
      >
        Open Standalone Inspector
      </button>

      {backendTraceError ? (
        <p style={{ color: '#b00020', marginTop: 0, fontSize: '13px' }}>
          Backend trace warning: {backendTraceError}
        </p>
      ) : null}

      <div style={{ maxHeight: '520px', overflowY: 'auto', border: '1px solid #e8e8e8', borderRadius: '8px', padding: '10px' }}>
        {mergedTimeline.length === 0 ? (
          <p style={{ margin: 0, color: '#555' }}>
            No flow events yet. Start a registration or authentication attempt to populate this timeline.
          </p>
        ) : (
          mergedTimeline.map((event) => {
            const isExpanded = Boolean(expandedRows[event.uiId]);
            const eventColor = event.source === 'backend' ? '#f3f8ff' : '#f9f6ff';
            const decodedPayload = decodeFlowPayload(event);

            return (
              <div
                key={event.uiId}
                style={{
                  border: '1px solid #e4e4e4',
                  borderRadius: '8px',
                  padding: '10px',
                  marginBottom: '8px',
                  background: eventColor,
                }}
              >
                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '10px', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: '12px', color: '#666' }}>
                      {formatTime(event.timestamp)} | {event.source} | {event.traceId || 'no-trace'}
                    </div>
                    <div style={{ fontWeight: 600, wordBreak: 'break-word' }}>{event.step || 'event'}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => toggleExpanded(event.uiId)}
                    style={{
                      border: '1px solid #d0d0d0',
                      background: '#fff',
                      borderRadius: '4px',
                      padding: '4px 8px',
                      cursor: 'pointer',
                    }}
                  >
                    {isExpanded ? 'Collapse' : 'Expand'}
                  </button>
                </div>

                {isExpanded ? (
                  <div style={{ marginTop: '10px' }}>
                    <div style={{ fontSize: '13px', color: '#555', marginBottom: '6px' }}>
                      direction: {event.direction || 'n/a'} | endpoint: {event.endpoint || 'n/a'} | status: {event.status || event.statusCode || 'n/a'}
                    </div>
                    <button
                      type="button"
                      onClick={() => copyPayload(event.payloadRaw)}
                      style={{
                        border: '1px solid #d0d0d0',
                        background: '#fff',
                        borderRadius: '4px',
                        padding: '4px 8px',
                        cursor: 'pointer',
                        marginBottom: '6px',
                      }}
                    >
                      Copy Raw Payload
                    </button>
                    {decodedPayload.shouldShowDecoded ? (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '8px' }}>
                        <div>
                          <div style={{ fontSize: '12px', color: '#444', marginBottom: '4px', fontWeight: 600 }}>Raw Payload</div>
                          <pre style={{
                            margin: 0,
                            background: '#121212',
                            color: '#e7e7e7',
                            fontSize: '12px',
                            lineHeight: '1.5',
                            padding: '10px',
                            borderRadius: '6px',
                            overflowX: 'auto',
                          }}>
                            {JSON.stringify(event.payloadRaw || {}, null, 2)}
                          </pre>
                        </div>
                        <div>
                          <div style={{ fontSize: '12px', color: '#444', marginBottom: '4px', fontWeight: 600 }}>Decoded / Annotated</div>
                          <div style={{
                            margin: 0,
                            background: '#0e1a22',
                            color: '#d9f3ff',
                            fontSize: '12px',
                            lineHeight: '1.5',
                            padding: '10px',
                            borderRadius: '6px',
                          }}>
                            {decodedPayload.fieldCards.map((field) => (
                              <div key={`${event.uiId}-${field.label}`} style={{ borderBottom: '1px solid rgba(217, 243, 255, 0.25)', paddingBottom: '8px', marginBottom: '8px' }}>
                                <div style={{ fontWeight: 700, color: '#ffffff' }}>{field.label}</div>
                                <div style={{ wordBreak: 'break-word' }}>{typeof field.value === 'string' ? field.value : JSON.stringify(field.value)}</div>
                                <div style={{ color: '#9fd6ee' }}>Why this matters: {field.why}</div>
                              </div>
                            ))}
                            {decodedPayload.annotations.length > 0 ? (
                              <div style={{ marginTop: '8px', color: '#b9ecff' }}>
                                Notes: {decodedPayload.annotations.join(' | ')}
                              </div>
                            ) : null}
                            {decodedPayload.conversions.length > 0 ? (
                              <div style={{ marginTop: '8px', color: '#b9ecff' }}>
                                Encoding: {decodedPayload.conversions.join(' | ')}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div>
                        <div style={{ fontSize: '12px', color: '#444', marginBottom: '4px', fontWeight: 600 }}>Raw Payload</div>
                        <pre style={{
                          margin: 0,
                          background: '#121212',
                          color: '#e7e7e7',
                          fontSize: '12px',
                          lineHeight: '1.5',
                          padding: '10px',
                          borderRadius: '6px',
                          overflowX: 'auto',
                        }}>
                          {JSON.stringify(event.payloadRaw || {}, null, 2)}
                        </pre>
                        <div style={{ marginTop: '8px', fontSize: '12px', color: '#555' }}>
                          Decoded view hidden: {decodedPayload.hiddenReason}
                        </div>
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export default FlowInspectorPanel;
