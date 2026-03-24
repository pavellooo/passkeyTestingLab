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

      <FlowInspectorPanel />
    </div>
  );
}

export default LandingPage;