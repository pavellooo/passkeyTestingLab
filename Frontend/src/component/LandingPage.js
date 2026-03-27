import React from 'react';
import { useNavigate } from 'react-router-dom';
import FlowInspectorPanel from './FlowInspectorPanel';

function LandingPage() {
  const navigate = useNavigate();

  return (
    <div style={{ maxWidth: '1080px', margin: '32px auto', padding: '0 16px' }}>
      <div style={{ textAlign: 'center', marginBottom: '18px' }}>
        <h1>Welcome to the App</h1>
        <p>Please log in or register to continue.</p>
        <button
          onClick={() => navigate('/login')}
          style={{ margin: '10px', padding: '10px 20px', fontSize: '16px' }}
        >
          Login / Register
        </button>
      </div>

      <div style={{ textAlign: 'center', marginTop: '32px' }}>
        <button
          onClick={() => window.open('/flow-inspector', '_blank', 'noopener,noreferrer')}
          style={{ margin: '10px', padding: '12px 28px', fontSize: '18px', background: '#1976d2', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer' }}
        >
          Open Flow Inspector
        </button>
        <button
          onClick={() => window.open('/flow-diagram', '_blank', 'noopener,noreferrer')}
          style={{ margin: '10px', padding: '12px 28px', fontSize: '18px', background: '#388e3c', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer' }}
        >
          Open Sequence Diagram
        </button>
      </div>
    </div>
  );
}

export default LandingPage;