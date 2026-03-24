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

const extractIdentityFromEvent = (event) => {
  const payload = event?.payloadRaw;
  if (!payload || typeof payload !== 'object') {
    return '';
  }

  return (
    payload.email ||
    payload.phone ||
    payload.username ||
    payload.user ||
    payload.name ||
    ''
  );
};

function FlowInspectorPage() {
  const navigate = useNavigate();
  const [flowEvents, setFlowEvents] = useState(window.__passkeyFlowEvents || loadPersistedFlowEvents());
  const [filterQuery, setFilterQuery] = useState('');
  const [selectedTraceId, setSelectedTraceId] = useState('');
  const [backendEvents, setBackendEvents] = useState([]);
  const [backendTraceError, setBackendTraceError] = useState('');
  const [expandedRows, setExpandedRows] = useState({});

  const clearAllTraces = () => {
    window.__passkeyFlowEvents = [];
    setFlowEvents([]);
    setBackendEvents([]);
    setExpandedRows({});
    setSelectedTraceId('');
    setBackendTraceError('');
    persistFlowEvents([]);
    window.dispatchEvent(new Event(FLOW_EVENT_UPDATED));
    broadcastFlowEvents([]);
  };

  const downloadTextFile = (filename, textContent, mimeType) => {
    const blob = new Blob([textContent], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  };

  const exportAsJson = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      selectedTraceId: selectedTraceId || null,
      filterQuery,
      ttlMs: FLOW_EVENTS_TTL_MS,
      frontendEvents: filteredFrontendEvents,
      backendEvents: normalizedBackendEvents,
      mergedTimeline,
    };

    const safeTrace = (selectedTraceId || 'all-traces').replace(/[^a-z0-9_-]/gi, '_');
    const filename = `passkey-flow-export-${safeTrace}-${Date.now()}.json`;
    downloadTextFile(filename, JSON.stringify(payload, null, 2), 'application/json');
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

  const traceSummaries = useMemo(() => {
    const summaryMap = new Map();

    for (let i = 0; i < flowEvents.length; i += 1) {
      const event = flowEvents[i];
      const traceId = event?.traceId;
      if (!traceId) {
        continue;
      }

      if (!summaryMap.has(traceId)) {
        summaryMap.set(traceId, {
          traceId,
          identity: '',
          flowType: '',
          lastTimestamp: event.timestamp || '',
        });
      }

      const existing = summaryMap.get(traceId);
      const identity = extractIdentityFromEvent(event);

      summaryMap.set(traceId, {
        traceId,
        identity: existing.identity || identity || '',
        flowType: existing.flowType || event.flowType || '',
        lastTimestamp: event.timestamp || existing.lastTimestamp,
      });
    }

    return Array.from(summaryMap.values()).sort((a, b) => {
      const aTime = new Date(a.lastTimestamp || 0).getTime();
      const bTime = new Date(b.lastTimestamp || 0).getTime();
      return bTime - aTime;
    });
  }, [flowEvents]);

  const traceSummaryMap = useMemo(() => {
    const map = new Map();
    traceSummaries.forEach((summary) => map.set(summary.traceId, summary));
    return map;
  }, [traceSummaries]);

  const filteredTraceSummaries = useMemo(() => {
    const normalizedQuery = filterQuery.trim().toLowerCase();
    if (!normalizedQuery) {
      return traceSummaries;
    }

    return traceSummaries.filter((summary) => {
      const haystack = `${summary.identity} ${summary.traceId} ${summary.flowType}`.toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [traceSummaries, filterQuery]);

  const identityGroups = useMemo(() => {
    const groups = new Map();
    filteredTraceSummaries.forEach((summary) => {
      const identityKey = summary.identity || 'unknown-identity';
      if (!groups.has(identityKey)) {
        groups.set(identityKey, []);
      }
      groups.get(identityKey).push(summary);
    });
    return Array.from(groups.entries());
  }, [filteredTraceSummaries]);

  useEffect(() => {
    if (!selectedTraceId && filteredTraceSummaries.length > 0) {
      setSelectedTraceId(filteredTraceSummaries[0].traceId);
      return;
    }

    if (selectedTraceId && filteredTraceSummaries.length > 0) {
      const stillVisible = filteredTraceSummaries.some((summary) => summary.traceId === selectedTraceId);
      if (!stillVisible) {
        setSelectedTraceId(filteredTraceSummaries[0].traceId);
      }
      return;
    }

    if (selectedTraceId && filteredTraceSummaries.length === 0) {
      setSelectedTraceId('');
    }
  }, [filteredTraceSummaries, selectedTraceId]);

  useEffect(() => {
    if (!selectedTraceId) {
      setBackendEvents([]);
      setBackendTraceError('');
      return undefined;
    }

    let active = true;

    const fetchBackendTrace = async () => {
      try {
        const response = await axios.get(apiUrl(`/webauthn/trace/${encodeURIComponent(selectedTraceId)}`));
        if (!active) {
          return;
        }

        const events = Array.isArray(response.data?.events) ? response.data.events : [];
        setBackendEvents(events);
        setBackendTraceError('');
      } catch (fetchError) {
        if (!active) {
          return;
        }

        if (fetchError.response?.status === 429) {
          setBackendTraceError('Trace polling is being rate-limited (429). Wait a moment or reduce concurrent tabs.');
          return;
        }

        if (fetchError.response?.status === 404) {
          setBackendEvents([]);
          setBackendTraceError('No backend events found for this trace yet.');
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
  }, [selectedTraceId]);

  const filteredFrontendEvents = useMemo(() => {
    return flowEvents
      .filter((event) => !selectedTraceId || event.traceId === selectedTraceId)
      .map((event, index) => ({
        ...event,
        uiId: `frontend-${index}-${event.timestamp}`,
        source: event.source || 'frontend',
      }));
  }, [flowEvents, selectedTraceId]);

  const normalizedBackendEvents = useMemo(() => {
    return backendEvents.map((event, index) => ({
      ...event,
      traceId: selectedTraceId,
      uiId: `backend-${index}-${event.timestamp}`,
      source: event.source || 'backend',
    }));
  }, [backendEvents, selectedTraceId]);

  const mergedTimeline = useMemo(() => {
    return [...filteredFrontendEvents, ...normalizedBackendEvents].sort((a, b) => {
      const aTime = new Date(a.timestamp || 0).getTime();
      const bTime = new Date(b.timestamp || 0).getTime();
      return aTime - bTime;
    });
  }, [filteredFrontendEvents, normalizedBackendEvents]);

  const expandAllRows = () => {
    const all = {};
    mergedTimeline.forEach((event) => {
      all[event.uiId] = true;
    });
    setExpandedRows(all);
  };

  const collapseAllRows = () => {
    setExpandedRows({});
  };

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
    <div style={{ maxWidth: '1100px', margin: '24px auto', padding: '0 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'center', marginBottom: '12px' }}>
        <h1 style={{ margin: 0 }}>Passkey Flow Inspector</h1>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={expandAllRows}
            style={{ border: '1px solid #d0d0d0', background: '#fff', borderRadius: '4px', padding: '8px 10px', cursor: 'pointer' }}
          >
            Expand All
          </button>
          <button
            type="button"
            onClick={collapseAllRows}
            style={{ border: '1px solid #d0d0d0', background: '#fff', borderRadius: '4px', padding: '8px 10px', cursor: 'pointer' }}
          >
            Collapse All
          </button>
          <button
            type="button"
            onClick={exportAsJson}
            style={{ border: '1px solid #d0d0d0', background: '#fff', borderRadius: '4px', padding: '8px 10px', cursor: 'pointer' }}
          >
            Export JSON
          </button>
          <button
            type="button"
            onClick={clearAllTraces}
            style={{ border: '1px solid #d0d0d0', background: '#fff', borderRadius: '4px', padding: '8px 10px', cursor: 'pointer' }}
          >
            Clear All Traces
          </button>
          <button
            type="button"
            onClick={() => navigate('/')}
            style={{ border: '1px solid #d0d0d0', background: '#fff', borderRadius: '4px', padding: '8px 10px', cursor: 'pointer' }}
          >
            Back To Landing Page
          </button>
        </div>
      </div>

      <div style={{ border: '1px solid #e0e0e0', borderRadius: '10px', padding: '12px', background: '#fff', marginBottom: '12px' }}>
        <label htmlFor="trace-filter" style={{ display: 'block', fontWeight: 600, marginBottom: '6px' }}>
          Filter by email, phone, or trace ID
        </label>
        <input
          id="trace-filter"
          type="text"
          value={filterQuery}
          onChange={(e) => setFilterQuery(e.target.value)}
          placeholder="Search identity or trace"
          style={{ width: '100%', padding: '10px', boxSizing: 'border-box', borderRadius: '6px', border: '1px solid #ccc', marginBottom: '8px' }}
        />

        {filteredTraceSummaries.length > 0 ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {filteredTraceSummaries.slice(0, 30).map((summary) => (
              <button
                key={summary.traceId}
                type="button"
                onClick={() => setSelectedTraceId(summary.traceId)}
                style={{
                  border: selectedTraceId === summary.traceId ? '1px solid #0f62fe' : '1px solid #d0d0d0',
                  background: selectedTraceId === summary.traceId ? '#edf4ff' : '#fafafa',
                  borderRadius: '4px',
                  padding: '4px 8px',
                  cursor: 'pointer',
                  fontSize: '12px',
                }}
              >
                {(summary.identity || 'Unknown identity')} | {(summary.flowType || 'unknown')} | {summary.traceId}
              </button>
            ))}
          </div>
        ) : (
          <p style={{ margin: 0, color: '#666' }}>No matching traces captured yet.</p>
        )}

        {identityGroups.length > 0 ? (
          <div style={{ marginTop: '10px', borderTop: '1px solid #eee', paddingTop: '8px' }}>
            <div style={{ fontSize: '13px', color: '#444', marginBottom: '6px' }}>Trace groups by identity</div>
            {identityGroups.slice(0, 10).map(([identity, summaries]) => (
              <div key={identity} style={{ fontSize: '12px', color: '#555', marginBottom: '4px' }}>
                {identity === 'unknown-identity' ? 'Unknown identity' : identity} - {summaries.length} trace{summaries.length === 1 ? '' : 's'}
              </div>
            ))}
          </div>
        ) : null}

        {selectedTraceId ? (
          <p style={{ marginTop: '10px', marginBottom: 0, fontSize: '13px', color: '#555' }}>
            Active trace: {selectedTraceId}
          </p>
        ) : null}
      </div>

      {backendTraceError ? (
        <p style={{ color: '#b00020', marginTop: 0 }}>{backendTraceError}</p>
      ) : null}

      <div style={{ border: '1px solid #e0e0e0', borderRadius: '10px', padding: '10px', background: '#fff', maxHeight: '620px', overflowY: 'auto' }}>
        {mergedTimeline.length === 0 ? (
          <p style={{ margin: 0, color: '#555' }}>
            No events for this trace yet. Trigger registration or authentication, then refresh/pick the latest trace ID.
          </p>
        ) : (
          mergedTimeline.map((event) => {
            const isExpanded = Boolean(expandedRows[event.uiId]);
            const bg = event.source === 'backend' ? '#f3f8ff' : '#f9f6ff';

            return (
              <div key={event.uiId} style={{ border: '1px solid #e4e4e4', borderRadius: '8px', padding: '10px', marginBottom: '8px', background: bg }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '10px', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: '12px', color: '#666' }}>
                      {formatTime(event.timestamp)} | {event.source} | {event.traceId || 'no-trace'}
                    </div>
                    {event.traceId && traceSummaryMap.get(event.traceId)?.identity ? (
                      <div style={{ fontSize: '12px', color: '#666' }}>
                        identity: {traceSummaryMap.get(event.traceId).identity}
                      </div>
                    ) : null}
                    <div style={{ fontWeight: 600, wordBreak: 'break-word' }}>{event.step || 'event'}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => toggleExpanded(event.uiId)}
                    style={{ border: '1px solid #d0d0d0', background: '#fff', borderRadius: '4px', padding: '4px 8px', cursor: 'pointer' }}
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
                      style={{ border: '1px solid #d0d0d0', background: '#fff', borderRadius: '4px', padding: '4px 8px', cursor: 'pointer', marginBottom: '6px' }}
                    >
                      Copy Raw Payload
                    </button>
                    <pre style={{ margin: 0, background: '#121212', color: '#e7e7e7', fontSize: '12px', lineHeight: '1.5', padding: '10px', borderRadius: '6px', overflowX: 'auto' }}>
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

export default FlowInspectorPage;
