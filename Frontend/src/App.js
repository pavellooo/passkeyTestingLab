import './App.css';
import { useState, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import axios from 'axios';
import Passkey from './component/passkey.js';
import Board from './component/Board';
import ProtectedRoute from './component/ProtectedRoute';
import LandingPage from './component/LandingPage.js';
import FlowInspectorPage from './component/FlowInspectorPage';

// IMPORTANT: set axios defaults once
axios.defaults.withCredentials = true;

const apiBase = (process.env.REACT_APP_API_BASE_URL || '').replace(/\/$/, '');
const apiUrl = (path) => `${apiBase}${path}`;

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [userEmail, setUserEmail] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  
  // Check authentication status on app load
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const response = await axios.post(
          apiUrl('/webauthn/verify-token'),
          {}, // no body — cookie is used
          { withCredentials: true }
        );

        if (response.data.success) {
          setIsAuthenticated(true);
          setUserEmail(response.data.email);
        } else {
          setIsAuthenticated(false);
          setUserEmail('');
        }
      } catch (error) {
        setIsAuthenticated(false);
        setUserEmail('');
      } finally {
        setIsLoading(false);
      }
    };

    checkAuth();
  }, []);
  
  // Logout function to clear token and authentication state
  const handleLogout = async () => {
    try {
      await axios.post(
        apiUrl('/webauthn/logout'),
        {},
        { withCredentials: true }
      );
    } catch (err) {
      console.error('Logout failed:', err);
    } finally {
      setIsAuthenticated(false);
      setUserEmail('');
    }
  };
  
  if (isLoading) {
    return <div>Loading...</div>;
  }
  
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route 
        path="/login" 
        element={
          isAuthenticated ? (
            <Navigate to="/tictactoe" />
          ) : (
            <Passkey setIsAuthenticated={setIsAuthenticated} setUserEmail={setUserEmail} />
          )
        } 
      />
      
      <Route
        path="/tictactoe"
        element={
          <ProtectedRoute
            element={<Board username={userEmail} onLogout={handleLogout} />}
            isAuthenticated={isAuthenticated}
          />
        }
      />

      <Route path="/flow-inspector" element={<FlowInspectorPage />} />
    </Routes>
  );
}

export default App;
