// Utility to decode JWTs (access/refresh tokens) and provide field descriptions
import { jwtDecode } from 'jwt-decode';

// Map of common JWT claim descriptions
const jwtFieldDescriptions = {
  iss: 'Issuer — identifies the principal that issued the JWT.',
  sub: 'Subject — identifies the principal that is the subject of the JWT.',
  aud: 'Audience — identifies the recipients that the JWT is intended for.',
  exp: 'Expiration Time — identifies the expiration time on or after which the JWT must not be accepted.',
  nbf: 'Not Before — identifies the time before which the JWT must not be accepted.',
  iat: 'Issued At — identifies the time at which the JWT was issued.',
  jti: 'JWT ID — unique identifier for the JWT.',
  email: 'User email address.',
  userId: 'Unique user identifier.',
  typ: 'Token type (e.g., access, refresh).',
  // Add more as needed
};

export function decodeJwtWithDescriptions(token) {
  if (!token) return null;
  try {
    const decoded = jwtDecode(token);
    return Object.entries(decoded).map(([key, value]) => ({
      key,
      value,
      description: jwtFieldDescriptions[key] || '',
    }));
  } catch (e) {
    return null;
  }
}
