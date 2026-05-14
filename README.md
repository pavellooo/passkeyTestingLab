# Project Passkey - Tic Tac Toe

A web application exploring the WebAuthn passkey authentication flow integrated with a Tic Tac Toe game. This project demonstrates secure, passwordless authentication using the FIDO2 standard.

Deployed version available at:
https://passkey-testing-lab-ecc52e0ca9c4.herokuapp.com/
Shortened URL:
https://tinyurl.com/passkeyTestingLab

- Note that the app is likely to be disabled if I do not expect to use it for a while, so that I can save on hosting costs. If you want to try it out, message me and I can enable it for you.

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

Should function both in local development and via this URL. Hosted on Heroku with a JawsDB MYSQL database. I tend to keep it disabled when not in use to save on hosting costs, but feel free to message me if you want to try it out and I can enable it for you.
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

### Two Local Run Modes

You can test the app two ways on your machine:

1. **Local development mode**: run the frontend and backend as separate local servers.
   - Frontend: `npm --prefix Frontend start`
   - Backend: `npm run start-backend`
   - Use this when you want fast React hot reload. Changes to the frontend will be reflected immediately without needing to restart either server.
   - However, backend changes will always require a backend restart to take effect.
   - See the next section for detailed local development instructions.

2. **Local production mode**: build the frontend and let the backend serve the static files.
   - Build and copy the frontend into the backend: `npm run deploy`
   - Start the backend: `npm run start-backend`
   - Or do both together: `npm run start:deployed-local`
   - Use this when you want to test the production serving path locally.
   - See the "Build and Deployment" section for more details.


### Local Development Mode

1. **Install all dependencies (one-time setup)**:
   ```bash
   npm run setup
   ```

   If any `node_modules` folders are missing, the setup step will reinstall them before you start the app.

2. **Configure Frontend API URL** (one-time setup):
   
A `.env` file may have been committed to source control for convenience. If the Frontend/.env file is missing, follow this step to create it:

   Copy or create `Frontend/.env` from the example (.env.example):
   ```bash
   cp Frontend/.env.example Frontend/.env
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

5. **Open the App**
   - Go to `http://localhost:3000` in your browser to access the frontend.

6. **Turn off the app**
   - Stop both servers by pressing `Ctrl + C` in each terminal, or by closing the terminal windows.

### Local Configuration

The local setup uses HTTP (not HTTPS) to avoid self-signed certificate issues. Both local run modes use the same `Backend/.env` settings, with one key difference:

**For local development mode** (separate frontend and backend servers):
```bash
NODE_ENV=development
ORIGIN=http://localhost:3000
RP_ID=localhost
(DB connection settings...)
PORT=5200
```

**For local deployed mode** (backend serves built frontend):
```bash
NODE_ENV=development
ORIGIN=http://localhost:5200          # ← Only this line changes
RP_ID=localhost
(DB connection settings...)
PORT=5200
```

The `.env` files are tracked in source control for convenience right now. Change the secrets and credentials before sharing the repo, and remove them from source control in the future once you are ready to harden the setup.

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

### Building for Production (Local Deployed Mode)

Before starting the backend, ensure `Backend/.env` is configured for local testing:
```bash
NODE_ENV=development
ORIGIN=http://localhost:5200
RP_ID=localhost
PORT=5200
```

To build the frontend and copy the built assets to `Backend/build`:
```bash
npm run deploy
```

Then start the backend server (which serves the built frontend):
```bash
npm run start-backend
```

Or do both steps in one command:
```bash
npm run start:deployed-local
```

Then visit `http://localhost:5200` in your browser. The backend will serve the pre-built frontend files.

### Heroku Deployment

This project is configured for easy deployment to Heroku using the provided `Procfile`.

#### Setup Steps

1. **Create Heroku App & Connect Git**:
   - Go to [Heroku Dashboard](https://dashboard.heroku.com)
   - Click "New" → "Create new app"
   - Enter your app name (for example, `my-passkey-app`)
   - In the Deploy tab, connect your GitHub repo and enable automatic deploys

2. **Add JawsDB MySQL Add-on**:
   - In the Heroku Dashboard, go to the Resources tab
   - Search for "JawsDB MySQL" in the Add-ons Marketplace
   - Select the free tier if available and attach it to the app
   - Heroku will expose the connection string as `JAWSDB_URL`

3. **Configure Environment Variables**:
   - In the Settings tab, click Reveal Config Vars
   - Add the following variables:
     ```
     NODE_ENV=production
     JWT_PRIVATE_KEY=<your-private-key>
     JWT_PUBLIC_KEY=<your-public-key>
     RP_ID=your-app-name.herokuapp.com
     ORIGIN=https://your-app-name.herokuapp.com
     ```
   - The backend can read local MySQL values directly or derive database settings from `JAWSDB_URL`
   - If there is some error with the database, you may need to parse that long URL into its components and set `DB_HOST`, `DB_USER`, `DB_PASSWORD`, and `DB_NAME` explicitly.

4. **Initialize Database**:
   - Use the JawsDB connection info to run the SQL from [Setup references/MYSQL_SETUP.md](Setup%20references/MYSQL_SETUP.md)
   - You can use MySQL Workbench, HeidiSQL, or the mysql CLI to import the schema

5. **Deploy**:
   - Push your branch to GitHub or Heroku
   - Heroku will run `npm run heroku-postbuild` and then start the app with `node Backend/Server.js`

#### Alternative: Vercel

If you want a frontend hosting option separate from Heroku, Vercel is a good fallback.

1. Push the repo to GitHub.
2. Sign in at [vercel.com](https://vercel.com).
3. Add the repo as a new project.
4. Set the Root Directory to `Frontend`.
5. Add the needed environment variables and deploy.
6. Use Railway or Render for the backend if you want a split deployment.

Heroku will automatically detect the Node.js project, run the build hook, and serve the deployed app at your Heroku domain.

#### Available NPM Scripts:

- `npm run setup` - Install root, backend, and frontend dependencies
- `npm start` - Start the backend server
- `npm run build` - Build frontend only
- `npm run deploy` - Build frontend and copy output into backend build folder
- `npm run start-backend` - Explicitly start the backend from the Backend workspace
- `npm run start:deployed-local` - Build/copy frontend, then start backend
- `npm run heroku-postbuild` - Heroku build hook (frontend dependency install + frontend build + backend dependency install)

### Environment Variables

Configure the following environment variables locally in `Backend/.env` and in Heroku config vars:

- `NODE_ENV` - Set to `production` for Heroku
- `PORT` - Server port (Heroku automatically sets this)
- `ORIGIN` - Frontend origin, for example `http://localhost:3000` locally or your Heroku URL in production
- `RP_ID` - WebAuthn relying party ID, for example `localhost` locally or `your-app-name.herokuapp.com` in production
- `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` - Local MySQL connection values
- `JAWSDB_URL` - Optional Heroku MySQL connection string provided by the JawsDB add-on
- `JWT_PRIVATE_KEY` - RSA private key used to sign JWTs
- `JWT_PUBLIC_KEY` - RSA public key used to verify JWTs

If you are configuring Heroku manually, use the Dashboard or `heroku config:set` to add these values.

For the frontend, `Frontend/.env` should point `REACT_APP_API_BASE_URL` at `http://localhost:5200` for local testing.

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
