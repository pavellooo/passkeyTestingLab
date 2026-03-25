require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const crypto = require('crypto');
const mysql = require('mysql2');
const base64url = require('base64url');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const https = require('https');
const http = require('http');
const path = require('path');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const Joi = require('joi');
const { verifyRegistrationResponse, verifyAuthenticationResponse } = require('@simplewebauthn/server');

// Environment configuration
const port = process.env.PORT || 5200;
const isProduction = process.env.NODE_ENV === 'production';

// Load JWT keys from environment variables
const readRequiredMultilineEnv = (envName) => {
    const value = process.env[envName];
    if (!value) {
        throw new Error(`Missing required environment variable: ${envName}. Ensure Backend/.env is configured.`);
    }
    return value.replace(/\\n/g, '\n');
};

const privateKey = readRequiredMultilineEnv('JWT_PRIVATE_KEY');
const publicKey = readRequiredMultilineEnv('JWT_PUBLIC_KEY');

const app = express();

const flowTraceStore = new Map();
const MAX_TRACES = 200;
const MAX_EVENTS_PER_TRACE = 120;

const generateServerTraceId = () => `srv-${Date.now().toString(36)}-${crypto.randomBytes(6).toString('hex')}`;

const sanitizeForTrace = (value, seen = new WeakSet()) => {
    if (value === null || value === undefined) {
        return value;
    }

    if (typeof value === 'function') {
        return '[Function]';
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

    if (Buffer.isBuffer(value)) {
        return `[Buffer:${value.length}]`;
    }

    if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
        const size = value.byteLength || value.length || 0;
        return `[Binary:${size}]`;
    }

    seen.add(value);

    if (Array.isArray(value)) {
        return value.map((entry) => sanitizeForTrace(entry, seen));
    }

    const sanitized = {};
    Object.keys(value).forEach((key) => {
        const lowered = key.toLowerCase();
        if (lowered.includes('token') || lowered.includes('cookie') || lowered.includes('authorization')) {
            sanitized[key] = '[MASKED]';
            return;
        }
        sanitized[key] = sanitizeForTrace(value[key], seen);
    });

    return sanitized;
};

const trimTraceStoreIfNeeded = () => {
    if (flowTraceStore.size <= MAX_TRACES) {
        return;
    }

    const oldestKey = flowTraceStore.keys().next().value;
    if (oldestKey) {
        flowTraceStore.delete(oldestKey);
    }
};

const recordTraceEvent = (traceId, event) => {
    if (!traceId) {
        return;
    }

    if (!flowTraceStore.has(traceId)) {
        flowTraceStore.set(traceId, {
            traceId,
            createdAt: new Date().toISOString(),
            events: []
        });
        trimTraceStoreIfNeeded();
    }

    const trace = flowTraceStore.get(traceId);
    trace.events.push({
        timestamp: new Date().toISOString(),
        ...event
    });

    if (trace.events.length > MAX_EVENTS_PER_TRACE) {
        trace.events = trace.events.slice(trace.events.length - MAX_EVENTS_PER_TRACE);
    }
};

// Trust proxy - required for Heroku to get real IP addresses
app.set('trust proxy', 1);

// CORS configuration
app.use(cors({
    origin: isProduction 
        ? process.env.FRONTEND_URL || true
        : ['http://localhost:3000', 'https://localhost:3000'],
    credentials: true
})); // use credentials for cookies
app.use(bodyParser.json());
app.use(cookieParser());

app.use('/webauthn', (req, res, next) => {
    const providedTraceId = req.headers['x-passkey-trace-id'];
    const traceId = typeof providedTraceId === 'string' && providedTraceId.trim().length > 0
        ? providedTraceId.trim()
        : generateServerTraceId();

    req.traceId = traceId;
    res.setHeader('x-passkey-trace-id', traceId);

    recordTraceEvent(traceId, {
        source: 'backend',
        direction: 'inbound',
        step: 'http.request',
        endpoint: req.originalUrl,
        method: req.method,
        payloadRaw: sanitizeForTrace(req.body)
    });

    const originalJson = res.json.bind(res);
    const originalSend = res.send.bind(res);
    let responseCaptured = false;

    const captureResponse = (body) => {
        if (responseCaptured) {
            return;
        }

        responseCaptured = true;
        recordTraceEvent(traceId, {
            source: 'backend',
            direction: 'outbound',
            step: 'http.response',
            endpoint: req.originalUrl,
            method: req.method,
            statusCode: res.statusCode,
            payloadRaw: sanitizeForTrace(body)
        });
    };

    res.json = (body) => {
        captureResponse(body);
        return originalJson(body);
    };

    res.send = (body) => {
        captureResponse(body);
        return originalSend(body);
    };

    next();
});

// Rate limiting middleware

// Use much higher limits for local development, strict for production
const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: isProduction ? 100 : 10000, // 100 in prod, 10,000 in dev
    message: 'Too many requests from this IP, please try again later.'
});

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: isProduction ? 5 : 1000, // 5 in prod, 1000 in dev
    message: 'Too many authentication attempts, please try again later.',
    skipSuccessfulRequests: true // Don't count successful requests
});

// Apply rate limiting to all routes
app.use(generalLimiter);

// Input validation schema
const emailSchema = Joi.object({
    email: Joi.string()
        .email()
        .required()
        .messages({
            'string.email': 'Please provide a valid email address',
            'any.required': 'Email is required'
        })
});

// Database connection pool with SSL support for production (auto-reconnects)
const pendingRegistrations = {}; // Store pending registrations in memory
const con = mysql.createPool({
    host: process.env.DB_HOST || "localhost",
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "Hashtag@123",
    database: process.env.DB_NAME || 'webauthn_passkey',
    ssl: isProduction ? {
        rejectUnauthorized: false  // JawsDB uses self-signed certificates
    } : undefined,
    connectionLimit: 10,
    waitForConnections: true,
    queueLimit: 0
});

// Test database connection
con.getConnection(function(err, connection) {
    if (err) {
        console.log('Error connecting to database');
        return;
    }
    console.log('Connected to Database');
    connection.release();
});

// Handle pool errors
con.on('error', (err) => {
    console.error('Database pool error:', err);
    if (err.code === 'PROTOCOL_CONNECTION_LOST') {
        console.log('Database connection lost. Pool will reconnect automatically.');
    }
});

// JWT token generation functions
const generateAccessToken = (email, userId) => {
  return jwt.sign(
    { email, userId },
    privateKey,
    { algorithm: 'RS256', expiresIn: process.env.JWT_ACCESS_TOKEN_EXPIRY || '15m' }
  );
};

const generateRefreshToken = (email, userId) => {
  return jwt.sign(
    { email, userId },
    privateKey,
    { algorithm: 'RS256', expiresIn: process.env.JWT_REFRESH_TOKEN_EXPIRY || '1d' }
  );
};

// Middleware to authenticate JWT tokens
const authenticateToken = (req, res, next) => {
    const token = req.cookies.accessToken;

    if (!token) return res.sendStatus(401).json({ error: 'Access token missing' });

    try {
        const decoded = jwt.verify(token, publicKey, { algorithms: ['RS256'] });
        req.user = decoded;
        next();
    }
    catch (err) {
        return res.status(403).json({ error: 'Invalid or expired token' });
    }
};

// Expected origin for WebAuthn verification
const expectedOrigin = process.env.EXPECTED_ORIGIN || 
    (isProduction 
        ? process.env.HEROKU_APP_URL || `https://${process.env.HEROKU_APP_NAME}.herokuapp.com`
        : 'https://localhost:5200');

const expectedRPID = process.env.EXPECTED_RP_ID || 
    (isProduction 
        ? process.env.HEROKU_APP_NAME || 'herokuapp.com'
        : 'localhost');

// Endpoint to complete registration
app.post('/webauthn/register', authLimiter, (req, res) => {
    const { email } = req.body;

    recordTraceEvent(req.traceId, {
        source: 'backend',
        direction: 'internal',
        step: 'registration.start',
        endpoint: '/webauthn/register',
        payloadRaw: sanitizeForTrace({ email })
    });

    // Validate email input
    const { error, value } = emailSchema.validate({ email });
    if (error) {
        return res.status(400).json({ error: error.details[0].message });
    }

    const validatedEmail = value.email;

    // Check if the user already exists
    const checkUserQuery = `SELECT * FROM users WHERE email = ?`;
    con.query(checkUserQuery, [validatedEmail], (err, results) => {
        if (err) {
            console.error('Error checking user:', err);
            return res.status(500).json({ error: 'Database error' });
        }

        if (!results) {
            console.error('Invalid database response');
            return res.status(500).json({ error: 'Database error' });
        }

        if (results.length > 0) {
            // If user already exists, return a message
            console.error('Email already exists');
            return res.status(409).json({ error: 'User already exists' });
        }

        // Proceed with registration if the user doesn't exist
        const userId = crypto.randomBytes(32).toString('base64');
       
        // Generate the challenge as a Buffer first
        const challengeBuffer = crypto.randomBytes(32);

        // Encode the challenge using base64url
        const challenge = base64url.encode(challengeBuffer);

        // Store pending registration in memory (not in database yet)
        pendingRegistrations[validatedEmail] = {
            userId,
            challenge,
            traceId: req.traceId,
            timestamp: Date.now()
        };

        // Clean up expired pending registrations (older than 5 minutes)
        const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
        Object.keys(pendingRegistrations).forEach(email => {
            if (pendingRegistrations[email].timestamp < fiveMinutesAgo) {
                delete pendingRegistrations[email];
            }
        });

        // Define WebAuthn options for registration
        const publicKeyCredentialCreationOptions = {
            challenge: challenge,
            rp: {
                name: 'Passwordless login',
                id: expectedRPID
            },
            user: {
                id: userId,
                name: validatedEmail,
                displayName: validatedEmail,
            },
            pubKeyCredParams: [
                { type: 'public-key', alg: -7 },
                { type: 'public-key', alg: -257 }
            ], // ES256 RS256
            authenticatorSelection: {
                authenticatorAttachment: 'platform',
                residentKey: 'required',
                userVerification: 'required',
            },
            attestation: 'direct',
        };

        // Respond with WebAuthn options
        res.json(publicKeyCredentialCreationOptions);
    });
});

// Endpoint to complete registration
app.post('/webauthn/register/complete', (req, res) => {
    const { email, credential } = req.body;
    if (!email || !credential) {
        return res.status(400).json({ error: 'Invalid request' });
    }

    // Check if there's a pending registration for this email
    const pendingReg = pendingRegistrations[email];
    
    if (!pendingReg) {
        console.error('No pending registration found for user:', email);
        return res.status(404).json({ error: 'No pending registration found. Please start registration again.' });
    }

    const { challenge: storedChallenge, userId } = pendingReg;
    const parsedCredential = credential;

    recordTraceEvent(req.traceId || pendingReg.traceId, {
        source: 'backend',
        direction: 'internal',
        step: 'registration.complete.received',
        endpoint: '/webauthn/register/complete',
        payloadRaw: sanitizeForTrace({ email, hasCredential: Boolean(credential), userId })
    });

    // Use async IIFE to handle verification
    (async () => {
        try {
            const verification = await verifyRegistrationResponse({
                response: parsedCredential,
                expectedChallenge: storedChallenge,
                expectedOrigin: expectedOrigin,
                expectedRPID: expectedRPID,
            });

            // Extract the verification result and registration information
            const { verified, registrationInfo } = verification;

            recordTraceEvent(req.traceId || pendingReg.traceId, {
                source: 'backend',
                direction: 'internal',
                step: 'registration.verify.result',
                endpoint: '/webauthn/register/complete',
                payloadRaw: sanitizeForTrace({ verified, hasRegistrationInfo: Boolean(registrationInfo) })
            });
            
            if (verified && registrationInfo) {
                // Debug the registration info structure
                console.log('Registration info structure:', 
                    JSON.stringify(registrationInfo, (key, value) => 
                        ArrayBuffer.isView(value) || value instanceof ArrayBuffer ? 
                        '[Binary data]' : value
                    )
                );
                
                // Validate that required credential data exists
                if (!registrationInfo.credential || 
                    !registrationInfo.credential.id || 
                    !registrationInfo.credential.publicKey) {
                    console.error('Missing required credential data in registrationInfo');
                    delete pendingRegistrations[email]; // Clean up pending registration
                    return res.status(400).json({ error: 'Registration failed: incomplete credential data' });
                }
                
                const initialCounter = 0;
                let credentialPublicKeyBase64;
                let credentialIDBase64url;
                
                // Store the credential ID directly in base64url format
                credentialIDBase64url = registrationInfo.credential.id;
                
                // Convert the public key to base64
                try {
                    credentialPublicKeyBase64 = Buffer.from(registrationInfo.credential.publicKey).toString('base64');
                } catch (error) {
                    console.error('Error converting publicKey to base64:', error);
                    delete pendingRegistrations[email]; // Clean up pending registration
                    return res.status(400).json({ error: 'Registration failed: invalid public key' });
                }

                // Define the SQL query to insert a new user with complete data
                const insertUserQuery = `
                    INSERT INTO users (email, user_id, credential, public_key, credential_id, counter, challenge) 
                    VALUES (?, ?, ?, ?, ?, ?, NULL)
                `;
                
                // Execute the SQL query to insert the user's complete information
                con.query(insertUserQuery, [
                    email,
                    userId,
                    JSON.stringify(registrationInfo),
                    credentialPublicKeyBase64,
                    credentialIDBase64url, 
                    initialCounter
                ], (dbError) => {
                    // Handle any database errors during credential storage
                    if (dbError) {
                        console.error('Error storing user:', dbError);
                        delete pendingRegistrations[email]; // Clean up pending registration
                        return res.status(500).json({ error: 'Database error' });
                    }
                    
                    // Clean up pending registration after successful insert
                    delete pendingRegistrations[email];
                    
                    // Send a success response to the client
                    res.json({ success: true });
                    
                    // Log the successful registration
                    console.log(`User and credentials saved for ${email}`);
                });
            } else {
                // Handle the case where verification failed
                console.error('Registration verification failed');
                delete pendingRegistrations[email]; // Clean up pending registration
                return res.status(400).json({ error: 'Registration verification failed' });
            }
        } catch (verificationError) {
            // Handle any errors that occurred during verification
            console.error('Verification error:', verificationError);
            delete pendingRegistrations[email]; // Clean up pending registration
            return res.status(400).json({ error: 'Verification error' });
        }
    })(); // Execute async IIFE
});

// Begin authentication
app.post('/webauthn/authenticate', authLimiter, (req, res) => {
    const { email } = req.body;

    recordTraceEvent(req.traceId, {
        source: 'backend',
        direction: 'internal',
        step: 'authentication.start',
        endpoint: '/webauthn/authenticate',
        payloadRaw: sanitizeForTrace({ email })
    });

    // Validate email input
    const { error, value } = emailSchema.validate({ email });
    if (error) {
        return res.status(400).json({ error: error.details[0].message });
    }

    const validatedEmail = value.email;

    // Generate a new challenge
    const challengeBuffer = crypto.randomBytes(32);
    const challenge = base64url.encode(challengeBuffer);
    
    console.log("Generated challenge for authentication:", challenge);

    // Store challenge in database
    const updateChallengeQuery = `UPDATE users SET challenge = ? WHERE email = ?`;
    con.query(updateChallengeQuery, [challenge, validatedEmail], (err) => {
        if (err) {
            console.error('Error updating challenge:', err);
            return res.status(500).json({ error: 'Database error' });
        }

        // Retrieve the credential ID for this user
        const getCredentialQuery = `SELECT credential_id FROM users WHERE email = ?`;
        con.query(getCredentialQuery, [validatedEmail], (err, results) => {
            if (err) {
                console.error('Error fetching credential ID:', err);
                return res.status(500).json({ error: 'Database error' });
            }
            
            if (!results || results.length === 0) {
                console.error('User not found or not registered');
                return res.status(404).json({ error: 'User not found or not registered' });
            }

            const credentialId = results[0].credential_id;

            // Send authentication request to frontend
            const publicKeyCredentialRequestOptions = {
                challenge: challenge,  // Use the same challenge format consistently
                allowCredentials: [
                    {
                        type: 'public-key',
                        id: credentialId,
                        transports: ['internal'],
                    }
                ],
                userVerification: 'required',
                timeout: 60000,
            };
            
            res.json(publicKeyCredentialRequestOptions);
        });
    });
});

app.post('/webauthn/authenticate/complete', (req, res) => {
    const { email, assertion } = req.body;

    recordTraceEvent(req.traceId, {
        source: 'backend',
        direction: 'internal',
        step: 'authentication.complete.received',
        endpoint: '/webauthn/authenticate/complete',
        payloadRaw: sanitizeForTrace({ email, hasAssertion: Boolean(assertion) })
    });

    if (!email || !assertion) {
        return res.status(400).json({ error: 'Invalid request' });
    }

    // Get the user data needed for verification
    const getUserDataQuery = `SELECT challenge, public_key, credential_id, counter FROM users WHERE email = ?`;
    
    con.query(getUserDataQuery, [email], async (err, results) => {
        if (err) {
            console.error('Error fetching user data:', err);
            return res.status(500).json({ error: 'Database error' });
        }

        if (!results || results.length === 0) {
            console.error('User not found:', email);
            return res.status(404).json({ error: 'User not found' });
        }
        
        const userData = results[0];
        
        if (!userData.challenge) {
            console.error('No active challenge found for user');
            return res.status(401).json({ error: 'No active authentication request' });
        }

        if (!userData.public_key || !userData.credential_id) {
            console.error('Public key or credential ID not found for user');
            return res.status(422).json({ error: 'User not properly registered' });
        }

        const storedChallenge = userData.challenge;
        const publicKeyBase64 = userData.public_key;
        const credentialId = userData.credential_id;
        const storedCounter = typeof userData.counter === 'number' ? userData.counter : 0;
        
        try {
            // Helper function to ensure base64url format
            const toBase64Url = (str) => {
                // If already base64url, return as-is
                if (!/[+/=]/.test(str)) {
                    return str;
                }
                
                // If standard base64, convert to base64url
                return str.replace(/\+/g, '-')
                          .replace(/\//g, '_')
                          .replace(/=+$/, '');
            };

            // Properly format all parts of the assertion for WebAuthn verification
            const formattedAssertion = {
                id: toBase64Url(assertion.id || assertion.rawId),
                rawId: toBase64Url(assertion.rawId || assertion.id),
                type: assertion.type,
                response: {
                    clientDataJSON: toBase64Url(assertion.response.clientDataJSON),
                    authenticatorData: toBase64Url(assertion.response.authenticatorData),
                    signature: toBase64Url(assertion.response.signature)
                }
            };
            
            // Add userHandle if it exists
            if (assertion.response.userHandle) {
                formattedAssertion.response.userHandle = toBase64Url(assertion.response.userHandle);
            }

            const verification = await verifyAuthenticationResponse({
                response: formattedAssertion,
                expectedChallenge: storedChallenge,
                expectedOrigin: expectedOrigin,
                expectedRPID: expectedRPID,
                credential: {
                    id: credentialId,
                    publicKey: Buffer.from(publicKeyBase64, 'base64'),
                    credentialPublicKey: Buffer.from(publicKeyBase64, 'base64'),
                    counter: storedCounter
                },
                requireUserVerification: true,
            });

            if (!verification.verified) {
                return res.status(401).json({ error: 'Authentication verification failed' });
            }

            const reportedCounter = Number(verification.authenticationInfo?.newCounter);
            const normalizedStoredCounter = Number.isFinite(storedCounter) ? storedCounter : 0;
            const hasReportedCounter = Number.isFinite(reportedCounter) && reportedCounter >= 0;
            // Some authenticators legitimately return 0 counters; keep DB counter monotonic.
            const nextCounter = hasReportedCounter
                ? Math.max(normalizedStoredCounter, reportedCounter)
                : normalizedStoredCounter;
            const counterDidRegress = hasReportedCounter && reportedCounter < normalizedStoredCounter;

            recordTraceEvent(req.traceId, {
                source: 'backend',
                direction: 'internal',
                step: 'authentication.verify.result',
                endpoint: '/webauthn/authenticate/complete',
                payloadRaw: sanitizeForTrace({
                    verified: verification.verified,
                    storedCounter: normalizedStoredCounter,
                    reportedCounter: hasReportedCounter ? reportedCounter : null,
                    nextCounter,
                    counterDidRegress
                })
            });
            
            console.log('Library verification successful:', JSON.stringify(verification, null, 2));

            if (counterDidRegress) {
                console.warn('Authenticator returned lower counter than stored value; preserving stored counter.', {
                    email,
                    storedCounter: normalizedStoredCounter,
                    reportedCounter,
                });
            }

            console.log('Authentication successful for user:', email);
            
            // Update the counter and clear the challenge
            const updateUserQuery = `UPDATE users SET challenge = NULL, counter = ? WHERE email = ?`;
            con.query(updateUserQuery, [nextCounter, email], (updateErr) => {
                if (updateErr) {
                    console.error('Error updating user data:', updateErr);
                    return res.status(500).json({ error: 'Database error' });
                }
                
                console.log('User data updated with counter:', nextCounter);
                
                const accessToken = generateAccessToken(email, results[0].user_id);
                const refreshToken = generateRefreshToken(email, results[0].user_id);
                
                res.cookie('accessToken', accessToken, {
                    httpOnly: true,
                    secure: true,
                    sameSite: 'Strict',
                    path: '/',
                    maxAge: 15 * 60 * 1000 // 15 minutes
                });

                res.cookie('refreshToken', refreshToken, {
                    httpOnly: true,
                    secure: true,
                    sameSite: 'Strict',
                    path: '/',
                    maxAge: 24 * 60 * 60 * 1000 // 1 day
                });

                return res.json({ success: true });
            });
        } catch (error) {
            console.error('Authentication verification error:', error);
            return res.status(401).json({ 
                error: 'Authentication failed',
                details: error.message
            });
        }
    });
});

// Verify token endpoint for session persistence
app.post('/webauthn/verify-token', (req, res) => {
    const token = req.cookies.accessToken;
    
    if (!token) {
        return res.status(400).json({ success: false, error: 'No token provided' });
    }
    
    try {
        const decoded = jwt.verify(token, publicKey, { algorithms: ['RS256'] });
        return res.json({ 
            success: true, 
            email: decoded.email,
            userId: decoded.userId
        });
    } catch (error) {
        return res.status(401).json({ success: false, error: 'Invalid or expired token' });
    }
});

app.post('/webauthn/refresh-token', (req, res) => {
    const { refreshToken } = req.body;

    if (!refreshToken) {
        return res.status(400).json({ success: false, error: 'No refresh token provided' });
    }

    try {
        const decoded = jwt.verify(refreshToken, publicKey, { algorithms: ['RS256'] });

        // Generate a new access token
        const newAccessToken = generateAccessToken(decoded.email, decoded.userId);

        res.cookie('accessToken', newAccessToken, {
            httpOnly: true,
            secure: true, // HTTPS enabled
            sameSite: 'Strict',
            path: '/',
            maxAge: 15 * 60 * 1000 // 15 minutes
        });

        res.json({ success: true});
    } catch (error) {
        console.error('Refresh token verification failed:', error);
        return res.status(401).json({ error: 'Invalid or expired refresh token' });
    }
});

const clearAuthCookies = (res) => {
    res.clearCookie('accessToken', {
        httpOnly: true,
        secure: true,
        sameSite: 'Strict',
        path: '/'
    });
    res.clearCookie('refreshToken', {
        httpOnly: true,
        secure: true,
        sameSite: 'Strict',
        path: '/'
    });
};

// Logout endpoint to clear cookies
app.post('/webauthn/logout', (req, res) => {
    clearAuthCookies(res);
    res.json({ success: true, message: 'Logged out successfully' });
});

app.get('/webauthn/trace/:traceId', (req, res) => {
    const { traceId } = req.params;
    const trace = flowTraceStore.get(traceId);

    if (!trace) {
        return res.status(404).json({ error: 'Trace not found' });
    }

    return res.json(trace);
});

// Backwards-compatible logout route
app.post('/logout', (req, res) => {
    clearAuthCookies(res);
    res.json({ success: true, message: 'Logged out successfully' });
});

//add this for switching to production
//const path = require('path');
// Serve static files from the React app
app.use(express.static(path.join(__dirname, '../Frontend/build')));

// Catch-all handler for React Router
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../Frontend/build', 'index.html'));
});

// Server startup with environment-based HTTPS handling
let server;

if (isProduction) {
    // Heroku handles HTTPS - use HTTP server internally
    server = http.createServer(app);
    server.listen(port, '0.0.0.0', () => {
        console.log(`🚀 Production server running on port ${port}`);
        console.log('🔒 HTTPS handled by Heroku');
        console.log(`📍 Expected origin: ${expectedOrigin}`);
    });
} else {
    // Local development - use HTTP to avoid self-signed cert issues
    server = http.createServer(app);
    server.listen(port, () => {
        console.log(`🔧 Development HTTP server running on http://localhost:${port}`);
        console.log(`📍 Expected origin: ${expectedOrigin}`);
    });
}

module.exports = server;