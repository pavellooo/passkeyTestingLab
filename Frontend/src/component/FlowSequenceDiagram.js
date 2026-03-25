import React, { useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';
import { useNavigate, useLocation } from 'react-router-dom';


// Helper to generate Mermaid sequence diagram from events, with event index for click mapping
function generateMermaidSequence(events) {
  if (!Array.isArray(events) || events.length === 0) {
    return 'sequenceDiagram\nNote over Frontend: No events to display';
  }
  let diagram = 'sequenceDiagram\n';
  events.forEach((event, idx) => {
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
    let label = event.step || event.endpoint || event.type || 'event';
    label = label.replace(/\n/g, ' | ');
    if (event.payloadRaw && typeof event.payloadRaw === 'object') {
      const keys = Object.keys(event.payloadRaw);
      if (keys.length > 0) {
        label += ` | (${keys.slice(0, 3).join(', ')}`;
        if (keys.length > 3) label += ', ...';
        label += ')';
      }
    }
    // Add event index for click mapping (Mermaid doesn't support row click, so we render a table below)
    diagram += `${from}->>${to}: ${label}\n`;
  });
  return diagram;
}

const FlowSequenceDiagram = () => {
  const diagramRef = useRef(null);
  const navigate = useNavigate();
  const location = useLocation();
  // Expect events, traceId, traceSummaries, traceEventsMap passed via location.state
  const locationState = location.state || {};
  const initialTraceId = locationState.traceId || '';
  const traceSummaries = locationState.traceSummaries || [];
  const traceEventsMap = locationState.traceEventsMap || {};

  // State for selected trace and selected event
  const [selectedTraceId, setSelectedTraceId] = useState(initialTraceId);
  const events = traceEventsMap[selectedTraceId] || [];
  const [selectedEventIdx, setSelectedEventIdx] = useState(0);

  useEffect(() => {
    if (diagramRef.current) {
      const diagram = generateMermaidSequence(events);
      mermaid.initialize({ startOnLoad: false });
      mermaid.render('mermaid-seq', diagram, (svgCode) => {
        diagramRef.current.innerHTML = svgCode;
      });
    }
    setSelectedEventIdx(0); // Reset selected event on trace change
  }, [events]);

  // Export as HTML
  function handleExportHTML() {
    if (!diagramRef.current) return;
    const svg = diagramRef.current.innerHTML;
    const html = `<!DOCTYPE html><html><head><meta charset='utf-8'><title>Sequence Diagram Export</title></head><body style='background:#fff;'>${svg}</body></html>`;
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sequence-diagram-${selectedTraceId || 'export'}.html`;
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
        a.download = `sequence-diagram-${selectedTraceId || 'export'}.png`;
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

  return (
    <div style={{ maxWidth: '1100px', margin: '24px auto', padding: '0 16px', display: 'flex', gap: '32px' }}>
      <div style={{ flex: 2, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h1 style={{ marginBottom: 0 }}>Passkey Flow Sequence Diagram</h1>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={handleExportHTML} style={{ border: '1px solid #0f62fe', background: '#eaf3ff', borderRadius: 4, padding: '7px 12px', fontWeight: 600, cursor: 'pointer' }}>Export HTML</button>
            <button onClick={handleExportPNG} style={{ border: '1px solid #0f62fe', background: '#eaf3ff', borderRadius: 4, padding: '7px 12px', fontWeight: 600, cursor: 'pointer' }}>Export PNG</button>
          </div>
        </div>
        <div style={{ marginBottom: '12px' }}>
          <button
            type="button"
            onClick={() => navigate(-1)}
            style={{ border: '1px solid #d0d0d0', background: '#fff', borderRadius: '4px', padding: '8px 10px', cursor: 'pointer' }}
          >
            Back to Inspector
          </button>
        </div>
        <div style={{ marginBottom: '12px', fontSize: '16px', color: '#444', display: 'flex', alignItems: 'center', gap: '16px' }}>
          <span>Trace:</span>
          <select
            value={selectedTraceId}
            onChange={e => setSelectedTraceId(e.target.value)}
            style={{ fontSize: '15px', padding: '4px 8px', borderRadius: '4px', border: '1px solid #bbb' }}
          >
            {traceSummaries.map(summary => (
              <option key={summary.traceId} value={summary.traceId}>
                {summary.traceId} {summary.label ? `- ${summary.label}` : ''}
              </option>
            ))}
          </select>
        </div>
        <div ref={diagramRef} style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: '8px', padding: '24px', overflowX: 'auto' }} />
        {/* Clickable event rows below diagram */}
        <div style={{ marginTop: '24px' }}>
          <h3 style={{ marginBottom: 8 }}>Events</h3>
          <div style={{ maxHeight: 260, overflowY: 'auto', border: '1px solid #eee', borderRadius: 6 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 15 }}>
              <thead>
                <tr style={{ background: '#f7f7f7' }}>
                  <th style={{ padding: '6px 8px', textAlign: 'left' }}>#</th>
                  <th style={{ padding: '6px 8px', textAlign: 'left' }}>Step / Type</th>
                  <th style={{ padding: '6px 8px', textAlign: 'left' }}>From</th>
                  <th style={{ padding: '6px 8px', textAlign: 'left' }}>To</th>
                  <th style={{ padding: '6px 8px', textAlign: 'left' }}>Time</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event, idx) => {
                  let from = 'Frontend', to = 'Backend';
                  if (event.direction === 'frontend->backend' || event.source === 'frontend') { from = 'Frontend'; to = 'Backend'; }
                  else if (event.direction === 'backend->frontend' || event.source === 'backend') { from = 'Backend'; to = 'Frontend'; }
                  else if (event.direction === 'browser->frontend') { from = 'Browser'; to = 'Frontend'; }
                  else if (event.direction === 'frontend->browser') { from = 'Frontend'; to = 'Browser'; }
                  if (!event.direction && event.source === 'frontend' && event.step && event.step.toLowerCase().includes('browser')) { from = 'Browser'; to = 'Frontend'; }
                  return (
                    <tr
                      key={idx}
                      style={{ background: idx === selectedEventIdx ? '#eaf3ff' : 'transparent', cursor: 'pointer' }}
                      onClick={() => setSelectedEventIdx(idx)}
                    >
                      <td style={{ padding: '6px 8px' }}>{idx + 1}</td>
                      <td style={{ padding: '6px 8px' }}>{event.step || event.endpoint || event.type || 'event'}</td>
                      <td style={{ padding: '6px 8px' }}>{from}</td>
                      <td style={{ padding: '6px 8px' }}>{to}</td>
                      <td style={{ padding: '6px 8px' }}>{event.timestamp ? new Date(event.timestamp).toLocaleTimeString() : ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      {/* Right-side card for selected event */}
      <div style={{ flex: 1, minWidth: 320, maxWidth: 420, background: '#f8fafd', border: '1px solid #e0e0e0', borderRadius: 10, padding: '20px 18px', marginTop: 48, height: 'fit-content' }}>
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
            <div style={{ marginBottom: 10 }}>
              <b>Annotations:</b>
              <pre style={{ background: '#f3f3f3', borderRadius: 4, padding: 8, fontSize: 14, margin: 0 }}>
                {selectedEvent.annotations ? pretty(selectedEvent.annotations) : 'None'}
              </pre>
            </div>
            <div style={{ marginBottom: 10 }}>
              <b>Payload:</b>
              <pre style={{ background: '#f3f3f3', borderRadius: 4, padding: 8, fontSize: 14, margin: 0 }}>
                {selectedEvent.payloadRaw ? pretty(selectedEvent.payloadRaw) : 'None'}
              </pre>
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
