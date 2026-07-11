# GitHub + Render + Netlify Live Deployment Guide

This project has 3 parts:

- **Frontend/Admin + Agent Portal**: Netlify
- **Backend API**: Render Web Service
- **Database**: Render PostgreSQL

## 1. Upload Project To GitHub

1. Go to GitHub.
2. Create a new repository, for example:
   `back-tracking-delivery-system`
3. Upload these project files/folders:
   - `backend/`
   - `delivery-tracker.html`
   - `delivery-tracker.css`
   - `delivery-tracker.js`
   - `agent.html`
   - `agent.css`
   - `agent.js`
   - `config.js`
   - `netlify.toml`
   - `_headers`
   - `_redirects`

## 2. Create PostgreSQL On Render

1. Open Render.
2. New > PostgreSQL.
3. Name:
   `back-tracking-db`
4. Region: closest available.
5. Create database.
6. Copy the **Internal Database URL**.

## 3. Create Backend Web Service On Render

1. Render > New > Web Service.
2. Connect your GitHub repo.
3. Root Directory:
   `backend`
4. Build Command:
   `npm install && npm run db:init`
5. Start Command:
   `npm start`
6. Add Environment Variables:

```env
DATABASE_URL=your_render_internal_database_url
GOOGLE_SHEETS_API_KEY=your_google_sheets_api_key
AUTH_SECRET=make-a-long-random-secret
ADMIN_USERNAME=admin
ADMIN_PASSWORD=change-this-admin-password
AGENT_USERNAME=agent001
AGENT_PASSWORD=change-this-agent-password
CORS_ORIGIN=https://your-netlify-site.netlify.app
DB_POOL_MAX=10
```

7. Deploy.
8. Test:
   `https://your-render-backend.onrender.com/health`

Expected:

```json
{ "ok": true, "service": "Back Tracking API" }
```

## 4. Connect Frontend To Backend

Open `config.js` and set your Render API URL:

```js
window.BACK_TRACKING_API_BASE = "https://your-render-backend.onrender.com";
```

Commit/upload the updated `config.js` to GitHub.

## 5. Deploy Frontend To Netlify

Option A, recommended: Git deploy.

1. Netlify > Add new site.
2. Import from GitHub.
3. Select your repo.
4. Publish directory:
   `.`
5. Build command:
   leave blank.
6. Deploy.

Pages:

- Admin: `https://your-netlify-site.netlify.app/admin`
- Agent: `https://your-netlify-site.netlify.app/agent`

## 6. Login Accounts

Admin:

```text
Username: value of ADMIN_USERNAME
Password: value of ADMIN_PASSWORD
```

Agent:

```text
Username: value of AGENT_USERNAME
Password: value of AGENT_PASSWORD
```

Also seeded agent accounts:

```text
agent001 / BT-2026-Agent001!
agent002 / BT-2026-Agent002!
...
agent100 / BT-2026-Agent100!
```

Change these later for security.

## 7. Recommended Flow

1. Admin opens `/admin`.
2. Admin saves Google Sheet links.
3. Admin syncs monthly sheets.
4. Backend stores records in PostgreSQL.
5. Agents open `/agent`.
6. Agents login and search CP numbers/waybills.

## Important

If Netlify and Render are separate domains, `CORS_ORIGIN` on Render must match your Netlify URL.
