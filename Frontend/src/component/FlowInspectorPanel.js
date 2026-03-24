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
