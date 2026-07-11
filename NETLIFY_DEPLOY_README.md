# Back Tracking & Delivery Reporting System

Netlify-ready static web application.

## Deploy

1. Open Netlify.
2. Choose **Add new site**.
3. Choose **Deploy manually**.
4. Drag and drop the generated zip file:
   `back-tracking-delivery-reporting-netlify.zip`

No build command is required. Netlify Functions are included for Google Sheet reading.

## First Login

Open the deployed site and login with:

- Username: `admin`
- Password: create any password with 6 or more characters

The password is stored as a browser-side SHA-256 hash with salt.

## Google Sheet Setup

For each month, paste one Google Sheet link in **Annual Google Sheets**.

Use the normal Google Sheet URL:

`https://docs.google.com/spreadsheets/d/SHEET_ID/edit?gid=0#gid=0`

The Netlify version reads sheets through a server-side Netlify Function, so it avoids browser CORS blocking.

The local `file://` preview is only reliable for checking the layout/dashboard. For real Google Sheet sync, deploy the zip to Netlify.

## Google Sheets API Key

For normal Google Sheet links, add this environment variable in Netlify:

- Key: `GOOGLE_SHEETS_API_KEY`
- Value: your Google Cloud API key with Google Sheets API enabled

Steps:

1. Google Cloud Console > APIs & Services
2. Enable **Google Sheets API**
3. Create an API key
4. Netlify site > Site configuration > Environment variables
5. Add `GOOGLE_SHEETS_API_KEY`
6. Redeploy the site

## Included Features

- Annual Google Sheet management by year and month
- Add, edit, replace, remove, validate, test connection, save, refresh, and sync
- Google Sheets as source of truth
- Internal IndexedDB sync database for fast dashboard/search/reporting
- Month re-sync replaces old synchronized rows to prevent stale data
- Dashboard metrics, charts, monthly trend, and recent records
- Customer history search by mobile, tracking number, customer, and product
- Product analytics
- CSV export and print/PDF report
- Settings backup/restore
- Dark mode and light mode
- Responsive desktop/mobile UI

## Important

For fully private Google Sheets, add OAuth or a Google service account to the Netlify Function. Keep Google credentials on the server only.
