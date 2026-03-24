import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom'
import axios from 'axios';

const apiBase = (process.env.REACT_APP_API_BASE_URL || '').replace(/\/$/, '');
const apiUrl = (path) => `${apiBase}${path}`;
const MAX_CLIENT_FLOW_EVENTS = 300;
const FLOW_EVENT_UPDATED = 'passkey-flow-updated';
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

const createTraceId = (flowType) => {
  const randomPart = Math.random().toString(36).slice(2, 10);
  return `${flowType}-${Date.now().toString(36)}-${randomPart}`;
};

const sanitizePayload = (value, seen = new WeakSet()) => {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'string') {
    return value.length > 2000 ? `${value.slice(0, 2000)}...[truncated]` : value;
  }

  if (typeof value !== 'object') {
    return value;
  }

  if (seen.has(value)) {
    return '[Circular]';
  }

  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    const size = value.byteLength || value.length || 0;
    return `[Binary:${size}]`;
  }

  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizePayload(entry, seen));
  }

  const sanitized = {};
  Object.keys(value).forEach((key) => {
    const lowered = key.toLowerCase();
    if (lowered.includes('token') || lowered.includes('cookie') || lowered.includes('authorization')) {
      sanitized[key] = '[MASKED]';
      return;
    }
    sanitized[key] = sanitizePayload(value[key], seen);
  });

  return sanitized;
};

const pushClientFlowEvent = (event) => {
  if (!window.__passkeyFlowEvents) {
    window.__passkeyFlowEvents = loadPersistedFlowEvents();
  }

  window.__passkeyFlowEvents = pruneExpiredFlowEvents(window.__passkeyFlowEvents);

  window.__passkeyFlowEvents.push({
    timestamp: new Date().toISOString(),
    ...event,
  });

  if (window.__passkeyFlowEvents.length > MAX_CLIENT_FLOW_EVENTS) {
    window.__passkeyFlowEvents = window.__passkeyFlowEvents.slice(
      window.__passkeyFlowEvents.length - MAX_CLIENT_FLOW_EVENTS
    );
  }

  persistFlowEvents(window.__passkeyFlowEvents);

  window.dispatchEvent(new Event(FLOW_EVENT_UPDATED));
  broadcastFlowEvents(window.__passkeyFlowEvents);
};

const logClientFlowEvent = (event) => {
  const normalizedEvent = {
    source: 'frontend',
    ...event,
    payloadRaw: sanitizePayload(event.payloadRaw),
  };

  pushClientFlowEvent(normalizedEvent);
  console.log('[PasskeyFlow]', normalizedEvent);
};

function Passkey( { setIsAuthenticated, setUserEmail } ) { //accepting setIsAuthenticated and setUserEmail as props
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [isLoginView, setIsLoginView] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();

  // Helper functions remain the same
  const base64UrlToBase64 = (base64url) => {
    const padding = '='.repeat((4 - base64url.length % 4) % 4);
    return base64url
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      + padding;
  };

  const base64UrlToUint8Array = (base64url) => {
    const base64 = base64UrlToBase64(base64url);
    const binary = atob(base64);
    return new Uint8Array(binary.split('').map(c => c.charCodeAt(0)));
  };

  const handleRegister = async () => {
    if (!email) {
      setError('Please enter your email');
      return;
    }

    setError('');
    setIsLoading(true);
    const traceId = createTraceId('registration');
    logClientFlowEvent({
      traceId,
      flowType: 'registration',
      step: 'registration.start',
      direction: 'internal',
      payloadRaw: { email },
    });
    
    try {
      console.log('Attempting to register with:', email);
      console.log('Backend URL:', apiUrl('/webauthn/register'));
      
      const { data: publicKeyCredentialCreationOptions } = await axios.post(
        apiUrl('/webauthn/register'), 
        { email },
        {
          headers: {
            'x-passkey-trace-id': traceId,
          },
        }
      );

      logClientFlowEvent({
        traceId,
        flowType: 'registration',
        step: 'registration.options.received',
        direction: 'inbound',
        endpoint: '/webauthn/register',
        payloadRaw: publicKeyCredentialCreationOptions,
      });

      const publicKeyCredentialCreationOptionsParsed = {
        challenge: base64UrlToUint8Array(publicKeyCredentialCreationOptions.challenge),
        rp: publicKeyCredentialCreationOptions.rp,
        user: {
          id: base64UrlToUint8Array(publicKeyCredentialCreationOptions.user.id),
          name: publicKeyCredentialCreationOptions.user.name,
          displayName: publicKeyCredentialCreationOptions.user.displayName
        },
        pubKeyCredParams: publicKeyCredentialCreationOptions.pubKeyCredParams,
        authenticatorSelection: publicKeyCredentialCreationOptions.authenticatorSelection,
        attestation: publicKeyCredentialCreationOptions.attestation,
      };

      const credential = await navigator.credentials.create({
        publicKey: publicKeyCredentialCreationOptionsParsed,
      });

      logClientFlowEvent({
        traceId,
        flowType: 'registration',
        step: 'browser.create.completed',
        direction: 'internal',
        endpoint: 'navigator.credentials.create',
        payloadRaw: {
          id: credential?.id,
          type: credential?.type,
          hasResponse: Boolean(credential?.response),
        },
      });

      await axios.post(apiUrl('/webauthn/register/complete'), {
        email,
        credential,
        
      }, {
        headers: {
          'x-passkey-trace-id': traceId,
        },
      });

      logClientFlowEvent({
        traceId,
        flowType: 'registration',
        step: 'registration.complete.sent',
        direction: 'outbound',
        endpoint: '/webauthn/register/complete',
        payloadRaw: { email, credentialId: credential?.id },
      });

      window.alert('Registration successful');
      setEmail('');
      setIsLoginView(true); // Switch to login view after successful registration

    } catch (error) {
      console.error('Registration failed - Full Error:', error);
      console.error('Error response:', error.response);
      console.error('Error request:', error.request);
      console.error('Error message:', error.message);

      logClientFlowEvent({
        traceId,
        flowType: 'registration',
        step: 'registration.error',
        direction: 'internal',
        status: 'error',
        payloadRaw: {
          message: error.message,
          response: error.response?.data,
        },
      });
      
      // More detailed error handling
      if (error.response) {
        // Server responded with error
        setError(`Server error: ${error.response.data?.error || error.message}`);
      } else if (error.request) {
        // Request made but no response
        setError(`Network Error: Backend not responding. Check REACT_APP_API_BASE_URL or backend availability at ${apiUrl('') || window.location.origin}`);
      } else {
        setError('Registration failed: ' + error.message);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleAuthenticate = async () => {
    if (!email) {
      setError('Email is required');
      return;
    }

    setIsLoading(true);
    setError('');
    const traceId = createTraceId('authentication');

    logClientFlowEvent({
      traceId,
      flowType: 'authentication',
      step: 'authentication.start',
      direction: 'internal',
      payloadRaw: { email },
    });
    
    try {
      const { data: publicKeyCredentialRequestOptions } = await axios.post(
        apiUrl('/webauthn/authenticate'),
        { email },
        {
          withCredentials: true,
          headers: {
            'x-passkey-trace-id': traceId,
          },
        }
      );

      logClientFlowEvent({
        traceId,
        flowType: 'authentication',
        step: 'authentication.options.received',
        direction: 'inbound',
        endpoint: '/webauthn/authenticate',
        payloadRaw: publicKeyCredentialRequestOptions,
      });

      const publicKeyCredentialRequestOptionsParsed = {
        challenge: base64UrlToUint8Array(publicKeyCredentialRequestOptions.challenge),
        allowCredentials: [{
          type: 'public-key',
          id: base64UrlToUint8Array(publicKeyCredentialRequestOptions.allowCredentials[0].id),
          transports: ['internal']
        }],
        userVerification: publicKeyCredentialRequestOptions.userVerification
      };

      const assertion = await navigator.credentials.get({ 
        publicKey: publicKeyCredentialRequestOptionsParsed 
      });

      logClientFlowEvent({
        traceId,
        flowType: 'authentication',
        step: 'browser.get.completed',
        direction: 'internal',
        endpoint: 'navigator.credentials.get',
        payloadRaw: {
          id: assertion?.id,
          type: assertion?.type,
          hasResponse: Boolean(assertion?.response),
        },
      });

      const assertionResponse = {
        id: assertion.id,
        rawId: btoa(String.fromCharCode(...new Uint8Array(assertion.rawId))),
        type: assertion.type,
        response: {
          authenticatorData: btoa(String.fromCharCode(...new Uint8Array(assertion.response.authenticatorData))),
          clientDataJSON: btoa(String.fromCharCode(...new Uint8Array(assertion.response.clientDataJSON))),
          signature: btoa(String.fromCharCode(...new Uint8Array(assertion.response.signature))),
          userHandle: assertion.response.userHandle ? 
            btoa(String.fromCharCode(...new Uint8Array(assertion.response.userHandle))) : 
            null
        }
      };

      const response = await axios.post(apiUrl('/webauthn/authenticate/complete'), {
        email,
        assertion: assertionResponse,
      }, {
        withCredentials: true,
        headers: {
          'x-passkey-trace-id': traceId,
        },
      });

      logClientFlowEvent({
        traceId,
        flowType: 'authentication',
        step: 'authentication.complete.response',
        direction: 'inbound',
        endpoint: '/webauthn/authenticate/complete',
        payloadRaw: response.data,
      });

      if (response.data.success) {
        // Store the token in a secure cookie for session persistence
        if (response.data.token) {
          console.log('Setting token in secure cookie:', response.data.token);
          // Removed document.cookie usage. Backend now handles secure cookies
        } else {
          console.log('No token received from backend');
        }
        setUserEmail(email);
        setIsAuthenticated(true); //update authentication state
        navigate('/tictactoe', { state: { username: email } }); // Redirect to Tic Tac Toe on success
      } else {
        setError(`Authentication failed: ${response.data.message || 'Unknown error'}`);
      }

      window.alert('Authentication successful');
      setEmail('');

    } catch (error) {
      console.error('Authentication failed:', error);
      logClientFlowEvent({
        traceId,
        flowType: 'authentication',
        step: 'authentication.error',
        direction: 'internal',
        status: 'error',
        payloadRaw: {
          message: error.message,
          response: error.response?.data,
        },
      });
      if (error.response?.data?.error) {
        setError(`Authentication failed: ${error.response.data.error}`);
      } else {
        setError(`Authentication failed: ${error.message}`);
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div style={{
      textAlign: 'center',
      marginTop: '50px',
      maxWidth: '450px',
      margin: '50px auto',
      padding: '20px',
      borderRadius: '8px',
      boxShadow: '0 2px 10px rgba(0, 0, 0, 0.1)',
      background: '#fff',
    }}>
      <h1>{isLoginView ? 'Login' : 'Register'}</h1>

      <div style={{ marginBottom: '20px' }}>
        <label style={{ display: 'block', textAlign: 'left', marginBottom: '8px' }}>
          Email or phone number
        </label>
        <input
          type="email"
          placeholder="example@email.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={{
            width: '100%',
            padding: '12px',
            borderRadius: '4px',
            border: '1px solid #ccc',
            fontSize: '16px',
            boxSizing: 'border-box',
          }}
        />
      </div>

      {error && <p style={{ color: 'red', marginBottom: '15px' }}>{error}</p>}

      <button
        onClick={isLoginView ? handleAuthenticate : handleRegister}
        disabled={isLoading}
        style={{
          width: '100%',
          padding: '12px',
          background: '#1a1a1a',
          color: 'white',
          border: 'none',
          borderRadius: '4px',
          fontSize: '16px',
          cursor: 'pointer',
          marginBottom: '15px',
        }}
      >
        {isLoading ? 'Processing...' : 'Continue'}
      </button>

      <button
        type="button"
        onClick={() => window.open('/flow-inspector', '_blank', 'noopener,noreferrer')}
        style={{
          width: '100%',
          padding: '10px',
          border: '1px solid #d0d0d0',
          background: '#fff',
          borderRadius: '4px',
          cursor: 'pointer',
          marginBottom: '10px',
        }}
      >
        Open Flow Inspector
      </button>

      <button
        type="button"
        onClick={() => navigate('/')}
        style={{
          width: '100%',
          padding: '10px',
          border: '1px solid #d0d0d0',
          background: '#fff',
          borderRadius: '4px',
          cursor: 'pointer',
          marginBottom: '10px',
        }}
      >
        Back To Landing Page
      </button>

      <div style={{ marginTop: '20px' }}>
        {isLoginView ? (
          <p>
            Don't have an account?{' '}
            <span
              onClick={() => setIsLoginView(false)}
              style={{ color: '#007bff', cursor: 'pointer', textDecoration: 'underline' }}
            >
              Register here.
            </span>
          </p>
        ) : (
          <p>
            Already have an account?{' '}
            <span
              onClick={() => setIsLoginView(true)}
              style={{ color: '#007bff', cursor: 'pointer', textDecoration: 'underline' }}
            >
              Login here.
            </span>
          </p>
        )}
      </div>
    </div>
  );
}

export default Passkey;
