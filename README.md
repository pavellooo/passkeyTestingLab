# Project Passkey - Tic Tac Toe

A web application exploring the WebAuthn passkey authentication flow integrated with a Tic Tac Toe game. This project demonstrates secure, passwordless authentication using the FIDO2 standard.


## Passkey Visibility Playground & Sequence Diagram Workflow

This project includes a **passkey playground** feature that captures and exposes all passkey-related traffic so you can inspect the complete WebAuthn flow (except for cryptographic secrets, which remain protected by hardware or 3rd-party authenticators like Google Password Manager).

### New Workflow: Sequence Diagram via File Upload

The sequence diagram page (`/flow-diagram`) now works by uploading a JSON trace file (exported from the inspector or backend). Real-time syncing and dropdown trace selection have been removed for simplicity and reliability.

**How to use the new diagram workflow:**
1. Run a registration or authentication flow in the app.
2. Open the Flow Inspector (`/flow-inspector`) and export the trace as JSON.
3. Go to `/flow-diagram` and upload the exported JSON file.
4. Click "Load" to visualize the full event sequence as a diagram.

Features:
- Four-lane sequence diagram: Secure Storage/Authenticator, Browser, Backend Server, Database.
- Captured backend DB trace events (`db.query.*`, `db.result.*`) are rendered as Backend <-> Database arrows.
- DB round-trips may be visually collapsed in the diagram view to reduce duplicate-looking query/result noise while preserving captured payload fidelity in details.
- Missing lanes can be inferred with synthetic events (marked in the details panel as `synthetic (inferred)`).
- Click any arrow/note to inspect details.
- Event details panel includes:
   - 1 to 3 summary bubbles (plain-English explanations)
   - Raw payload JSON
   - Copy button for raw payload
   - Field-by-field breakdown
- Frontend "response received" mirror events are shown as internal browser handling (to avoid double-counting backend responses).

### Login Page JWT Visibility Controls

The passkey login/register page now includes explicit JWT visibility controls:

- `Show JWT Details` / `Hide JWT Details` toggle to expand or collapse the JWT detail section.
- `Use insecure demo JWT payload mode for authentication flow` checkbox to request insecure demo payload behavior for testing.
- Secure vs insecure example payload cards to show expected token/cookie handling differences.

Note: These controls are for local testing and education only. Insecure demo payload visibility and relaxed cookie flags must never be used in production.

### Sequence Diagram Notes

- `error: null` in DB result payloads means there was **no** SQL/database error.
- `ok: true` means the DB operation completed successfully.
- `rowCount` indicates how many rows were returned/matched.


For details on the planning and current status of the project, see [PASSKEY_FLOW_VISIBILITY_PLAN.md](PASSKEY_FLOW_VISIBILITY_PLAN.md).

## Deployment Status

Should function both in local development and via this URL. Hosted on Heroku with a JawsDB MYSQL database
https://passkey-testing-lab-ecc52e0ca9c4.herokuapp.com/

## Project Overview

This is a full-stack application with:
- **Frontend**: React-based single-page application (SPA)
- **Backend**: Node.js/Express server with WebAuthn authentication
- **Database**: MySQL for user credentials and sessions
- **Passkey Authentication**: Secure FIDO2 WebAuthn implementation

## Prerequisites

- Node.js 20.x
- npm 10.x
- MySQL server (for database)
- Heroku CLI (for deployment)

## Project Structure

```
├── Frontend/          # React application
├── Backend/           # Express server
├── build-and-deploy.js # Build automation script
├── Procfile           # Heroku deployment configuration
└── package.json       # Root package configuration
```

## Getting Started

### Local Development

1. **Install all dependencies (one-time setup)**:
   ```bash
   npm run setup
   ```

2. **Configure Frontend API URL** (one-time setup):
   Copy or create `Frontend/.env` from the example (.env.example):
   ```bash
   cp Frontend/.env.example Frontend/.env
   ```
   Or manually create `Frontend/.env`:
   ```bash
   REACT_APP_API_BASE_URL=http://localhost:5200
   ```

3. **Run the frontend dev server** (in one terminal):
   ```bash
   npm --prefix Frontend start
   ```
   Frontend will be available at `http://localhost:3000`

4. **Run the backend server** (in another terminal):
   ```bash
   npm run start-backend
   ```
   Backend will be available at `http://localhost:5200`

5. **Open the standalone flow inspector** (optional but recommended):
   - `http://localhost:3000/flow-inspector`
   - Select or paste a trace ID to filter events for one flow.

### Local Configuration

The local setup uses HTTP (not HTTPS) to avoid self-signed certificate issues. Key values in `Backend/.env` for local dev:

```bash
NODE_ENV=development
EXPECTED_ORIGIN=http://localhost:3000
EXPECTED_RP_ID=localhost
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=Hashtag@123
DB_NAME=webauthn_passkey
PORT=5200
```

Do not use the production Heroku values locally; the commented section in `Backend/.env` shows those for reference only.

### Local Troubleshooting

If backend startup fails with `EADDRINUSE: address already in use :::5200`, another process is already using port 5200.

On Windows, find and stop the process:

```bash
netstat -ano | findstr :5200
taskkill /PID <PID_FROM_NETSTAT> /F
```

Or run the backend on another port by setting `PORT` in `Backend/.env`, for example:

```bash
PORT=5300
```

## Build and Deployment

### Building for Production

To build the frontend and copy the built assets to `Backend/build`:
```bash
npm run deploy
```

To start the backend server (which serves the built frontend):
```bash
npm run start-backend
```

To do both steps in one command:
```bash
npm run start:deployed-local
```

### Heroku Deployment

This project is configured for easy deployment to Heroku using the provided `Procfile`.

#### Deploy Steps:

1. **Set up Heroku (first time only)**:
   ```bash
   heroku login
   heroku create your-app-name
   ```

2. **Configure environment variables** (via command line or on Heroku dashboard):
   ```bash
   heroku config:set VARIABLE_NAME=value
   ```

3. **Deploy to Heroku**:
   ```bash
   git push heroku main
   ```

Heroku will automatically:
- Detect Node.js project
- Run `npm run heroku-postbuild` to install frontend dependencies, build frontend, and install backend dependencies
- Start the app using the command in `Procfile` (node Backend/Server.js)
- Serve your application at your Heroku domain

#### Available NPM Scripts:

- `npm run setup` - Install root, backend, and frontend dependencies
- `npm start` - Start the backend server
- `npm run build` - Build frontend only
- `npm run deploy` - Build frontend and copy output into backend build folder
- `npm run start-backend` - Explicitly start the backend from the Backend workspace
- `npm run start:deployed-local` - Build/copy frontend, then start backend
- `npm run heroku-postbuild` - Heroku build hook (frontend dependency install + frontend build + backend dependency install)

### Environment Variables

Configure the following environment variables for your Heroku app. These are used by the backend server for database connections, authentication, and other configurations.

#### Setting Environment Variables on Heroku:

```bash
# Set individual variables
heroku config:set DATABASE_URL="mysql://user:password@host:port/database"
heroku config:set JWT_PUBLIC_KEY="your-public-key"
heroku config:set NODE_ENV="production"

# Or set multiple at once
heroku config:set VAR1=value1 VAR2=value2 VAR3=value3
```
The heroku variables should follow the same names as in the [.env.example] file

#### View Current Configuration:

```bash
heroku config
```

#### Common Environment Variables:

These variables should be set in your `.env` file locally and in Heroku config:
- `DATABASE_URL` - MySQL connection string
- `JWT_SECRET` - Secret key for JWT token signing
- `NODE_ENV` - Set to "production" for Heroku
- `PORT` - Server port (Heroku automatically sets this)

### SSL Certificates

If using HTTPS with SSL certificates locally or on Heroku:

#### Local Development:

1. Generate self-signed certificates (for development only):
   ```bash
   openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 365 -nodes
   ```

2. Store certificates in a `certs/` directory (excluded from git):
   ```bash
   mkdir certs
   # Move your cert.pem and key.pem files here
   ```

3. Add `certs/` to `.gitignore`:
   ```
   certs/
   ```

Note that certs have been left in the backend for testing purposes. They are not used in the current Heroku deployment. It is highly recommended that they should be rotated often and never be uploaded to the repository.

#### Heroku Deployment:

For production SSL on Heroku:
- Use Heroku's **Automatic Certificate Management** (ACM) - automatically provides free SSL certificates
- Or configure a custom domain with your own SSL certificate through Heroku's settings
- No need to commit certificate files to the repository

- Heroku has many database management addons to choose from with different pricing tiers. Choose one that is compatible with MySQL. JawsDB free tier provides 5 megabytes of storage and a very simple setup guide, so that is what we chose to use.

#### .gitignore:

Create or update `.gitignore` to exclude sensitive files and generated builds:

```
# Dependencies
node_modules/

# Generated builds
Frontend/build/
Backend/build/

# Environment variables
.env
.env.local

# SSL Certificates
certs/

# IDE
.DS_Store
.vscode/
.idea/
```

## Database Setup

Refer to [Setup references/MYSQL_SETUP.md](Setup%20references/MYSQL_SETUP.md) for MySQL database configuration and schema setup.

### Quick Local MySQL Setup (Windows)

Use this quick flow if you are setting up local development from scratch.

1. Start your MySQL server.
2. Open a terminal and connect as root:
   ```bash
   mysql -u root -p
   ```
3. Create the local database and app user (example values):
   ```sql
   CREATE DATABASE webauthn_passkey;
   CREATE USER 'pp_user'@'localhost' IDENTIFIED BY 'your_strong_password';
   GRANT ALL PRIVILEGES ON webauthn_passkey.* TO 'pp_user'@'localhost';
   FLUSH PRIVILEGES;
   ```
4. Import schema from the project root:
   ```bash
   mysql -u pp_user -p webauthn_passkey < "Setup references/database_setup.sql"
   ```
5. Set matching values in `Backend/.env`:
   ```bash
   DB_HOST=localhost
   DB_USER=pp_user
   DB_PASSWORD=your_strong_password
   DB_NAME=webauthn_passkey
   ```
6. Start backend again:
   ```bash
   npm run start-backend
   ```

For more detail, keep using [Setup references/MYSQL_SETUP.md](Setup%20references/MYSQL_SETUP.md).

## Technology Stack

- **Frontend**: React, CSS
- **Backend**: Express.js, Node.js
- **Authentication**: @simplewebauthn/server (FIDO2/WebAuthn)
- **Database**: MySQL
- **Security**: JWT, CORS, Rate Limiting, Cookie Parser

## License

ISC
