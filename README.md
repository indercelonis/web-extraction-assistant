# Task Mining webpage extraction assistant

Local, browser-only helper. It never uploads files. Use it to turn a saved webpage into Task Mining `WebPageDataExtraction` keys, XPaths, and URL filters.

Cloud / SSO hosting: deploy configs are in this folder. Prefer **Cloud Run + Identity-Aware Proxy** so only `@celonis.com` Google accounts can open the app. Plain Firebase Hosting is public to anyone with the URL. Customer HTML still never leaves the browser when someone uses the tool.

## Deploy (Celonis-only)

1. Get a Celonis GCP project (Cloud access is case-by-case — ask your GCP/IT contact).
2. Install [Google Cloud SDK](https://cloud.google.com/sdk/docs/install) and sign in: `gcloud auth login` with your Celonis account.
3. From this folder:

```bash
chmod +x deploy/deploy-cloudrun.sh
./deploy/deploy-cloudrun.sh YOUR_GCP_PROJECT_ID
```

4. In Cloud Console → **Identity-Aware Proxy**, turn IAP on for the Cloud Run service and grant **IAP-secured Web App User** to `domain:celonis.com` (or a Google Group). Then remove public `allUsers` invoke.

Optional public Firebase Hosting (not Celonis-gated): put the project id in `.firebaserc`, then `./deploy/deploy-firebase.sh`.

## Start

```bash
cd tools/web-extraction-assistant
chmod +x serve.sh
./serve.sh
```

Open [http://127.0.0.1:8765/](http://127.0.0.1:8765/) in Chrome or Edge.

Do not open `index.html` as `file://`. OCR and PDF workers need `http://127.0.0.1`.

Optional port: `./serve.sh 9000`

## One file (share on Drive / email)

For HTML, ZIP, and folder drops only (no screenshot OCR / PDF):

```bash
node pack-single-html.mjs
```

That writes `wea-single.html`. Open it in Chrome or Edge (double-click is fine). Rebuild after you change the app.

## What to drop

| You have | What the tool can do |
|---|---|
| Folder containing saved webpages | Recursively finds HTML files, ignores all other files, and suggests keys, XPaths, URL filters and sample values |
| Complete Webpage zip, or the `.html` plus `_files` | Keys, XPaths, URL filters, match counts, sample values |
| Screenshot / photo | Field **names** only (Tesseract OCR). No trustworthy XPath or URL |
| PDF | Same as screenshot if it is a scan; text PDFs give labels only |
| Existing `.recconf` | Merge exported rules into it |

Chrome: **Save as** → **Webpage, Complete**. Add the saved page **folder**, or zip the `.html` together with its `_files` folder.

Everything goes through one **Add pages** button, which asks whether you are adding a folder or files:

- **A folder** recursively scans a directory, including the `_files` subfolder. One folder per pick.
- **Files or a ZIP** selects any number of files, including ZIP archives.
- Drag and drop accepts a mixed selection of files, ZIP archives, and folders in one gesture.

A browser cannot offer one native picker that selects both files and folders, so the single button routes to the matching picker.

**Uploads accumulate.** Each pick is added to the session rather than replacing it, so a folder and a stray file can be combined across several picks, and saved rules survive. A page already loaded is skipped rather than duplicated, matched on filename and contents so the same page picked once on its own and once inside a folder counts as one. **Start over** clears everything.

Prefer the folder. A saved page keeps its iframes as separate files under `_files`, and a browser cannot follow those relative links from a lone `.html`. Many enterprise apps, including Pulse and Power Apps, render the real data grid inside an iframe, so a single-file upload shows only the outer shell.

Folder mode:

- Scans nested folders for `.html`, `.htm`, and `.xhtml` files.
- Ignores images, CSS, JavaScript, fonts, JSON, PDFs and other non-HTML files.
- Reports how many HTML files were processed and how many other files were ignored.
- Shows a clear error when the folder is empty or contains no HTML.
- Skips duplicate paths, unreadable files, and individual files over 45 MB with an explanation.

## How to use

1. Drop files.
2. Pick the **iframe / inner page** when the tab is SharePoint and the form is Power Apps (`V1.html`).
3. Pick a field. Read match count and sample text.
4. If the sample is a whole page of labels, reject the path.
5. Copy the key, XPath, URL, or all three together. Keep the rule when it is ready.
6. Download XML/CSV. If you also dropped a recconf, you get `updated.recconf`.

Click **Run self-tests** on the page after changing code.

For the full automated suite:

```bash
npm test
```

## Image reader

Bundled **Tesseract.js** (Apache-2.0), fully local (`vendor/tesseract`). English trained data is included. It reads PNG, JPEG, WebP, BMP, GIF. It cannot see the DOM, so it will not invent XPaths.

PDFs use bundled **PDF.js** (Apache-2.0).

## Limits

- Saved pages with no `saved from url=` comment may need a manual URL filter.
- Folder mode accepts up to 5,000 HTML files and 500 MB of processable input per selection.
- Selected-row SharePoint paths need the live selected class. The tool also offers a first-row fallback and will say so.
- No path is 100% on every customer site. The tool always shows matches and sample text so a bad path is visible.
- Customer HTML can contain personal data. Keep it on your machine.

## Layout

- `index.html`, `css/`, `js/` — app
- `vendor/` — JSZip, Tesseract.js, PDF.js (do not delete)
- `fixtures/` — tiny synthetic pages for trials
- `node_modules/` — only used to refresh vendor files (`npm install`)
