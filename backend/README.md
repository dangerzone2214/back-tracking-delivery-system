# Back Tracking Backend

Node.js + Express + PostgreSQL backend for the Back Tracking & Delivery Reporting System.

## Features

- Save yearly/monthly Google Sheet links
- Server-side Google Sheets reading
- Sync monthly or yearly data into PostgreSQL
- Search by receiver cellphone, waybill, receiver, remarks, sender
- Dashboard metrics
- Product/brand reports
- RTS count and RTS rate support

## Setup

1. Install dependencies:

```bash
npm install
```

2. Copy environment file:

```bash
copy .env.example .env
```

3. Edit `.env`:

```env
PORT=4000
DATABASE_URL=postgres://postgres:postgres@localhost:5432/back_tracking
GOOGLE_SHEETS_API_KEY=your_google_sheets_api_key
CORS_ORIGIN=http://localhost:8787,https://your-netlify-site.netlify.app
```

4. Initialize database:

```bash
npm run db:init
```

5. Start backend:

```bash
npm run dev
```

For live deployment, follow:

`../GITHUB_RENDER_NETLIFY_STEPS.md`

## API Endpoints

- `GET /health`
- `GET /api/sheets/:year`
- `PUT /api/sheets/:year/:month`
- `DELETE /api/sheets/:year/:month`
- `POST /api/sync/:year/:month`
- `POST /api/sync/:year`
- `GET /api/search?q=9309363206`
- `GET /api/dashboard?year=2026&month=2`
- `GET /api/products`

## Google Sheet Headers

The backend is mapped to these headers:

- Creator Code
- Waybill Number
- Order Status
- SigningTime
- Receiver
- Receiver Cellphone
- Submission Time
- Remarks
- Sender Name
