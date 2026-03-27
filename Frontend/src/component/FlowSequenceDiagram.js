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
    if (key === 'challenge') return 'A random challenge for authentication.';
    if (key === 'allowCredentials') return 'List of allowed credentials for this operation.';
    if (key === 'type') return value === 'public-key' ? 'Credential type: public-key.' : `Type: ${value}`;
    if (key === 'id') return 'Credential ID.';
    if (key === 'transports') return 'Allowed transports for the credential.';
    if (key === 'userVerification') return `User verification requirement: ${value}.`;
    if (key === 'timeout') return `Timeout in milliseconds.`;
    if (key === 'origin') return 'Origin of the request.';
    if (key === 'rpId') return 'Relying Party ID.';
    if (key === 'username') return 'Username for the credential.';
    if (key === 'displayName') return 'Display name for the user.';
    if (key === 'publicKey') return 'Public key data.';
    if (key === 'authenticatorData') return 'Authenticator data.';
    if (key === 'signature') return 'Signature for the assertion.';
    if (key === 'clientDataJSON') return 'Client data in JSON format.';
    if (key === 'attestationObject') return 'Attestation object.';
    if (key === 'extensions') return 'Extensions included.';
    if (Array.isArray(value)) return `Array with ${value.length} item(s).`;
    if (typeof value === 'object' && value !== null) return 'Nested object.';
    return '';
  }

  // Recursively generate a flat, readable list for the payload (unlimited depth)
  function describePayload(payload) {
    if (!payload || typeof payload !== 'object') return <div>No payload.</div>;
    let desc = [];
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
