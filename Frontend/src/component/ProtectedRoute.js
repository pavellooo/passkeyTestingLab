import React from 'react';
import { Navigate } from 'react-router-dom';


// Protects routes by redirecting unauthenticated users to home
function ProtectedRoute({ element, isAuthenticated }) {
  if (isAuthenticated) {
    return element;
  }
  return <Navigate to="/" />;
}

export default ProtectedRoute;