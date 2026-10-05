QBridge Coffee Market Data
Auto-updating coffee reference prices and IDR/USD exchange rate, deployed via GitHub Pages + GitHub Actions.
📊 Data Sources
Table
Asset	Symbol	Source	Unit
Arabica C-Market	KC=F	Yahoo Finance	cents/lb
Robusta group indicator	ICO-ROBUSTAS	International Coffee Organization	US cents/lb; converted to USD/ton equivalent for calculator
IDR/USD	IDR=X	Yahoo Finance	IDR per 1 USD
🚀 Setup
1. Create Repository
bash
Copy
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_KGS-blog/Update-Coffee-Data.git
git push -u origin main
2. Enable GitHub Pages
Go to Settings → Pages
Source: Deploy from a branch
Branch: main / folder: (root)
Save
3. Enable GitHub Actions
Go to Actions tab
Click "I understand my workflows, go ahead and enable them"
Workflow will run automatically every 6 hours
4. Manual Trigger
Go to Actions → Update Coffee Market Data
Click Run workflow button
Data updates in ~30 seconds
📁 File Structure
plain
Copy
.
├── .github/workflows/
│   └── update-coffee-data.yml    # GitHub Actions cron job
├── scripts/
│   └── fetch-prices.js           # Node.js fetch script
├── data/
│   └── market-data.json          # Live data (auto-updated)
├── index.html                    # Your laporan USDA HTML
└── README.md
🔧 How It Works
GitHub Actions runs every 6 hours (or manual trigger)
scripts/fetch.js obtains Arabica and IDR/USD from Yahoo Finance and the daily Robustas group indicator from the ICO public indicator feed.
The same run imports `exports/coffee_relevant_articles.json` from `KGS-blog/coffee-intelligence-engine` into `data/coffee-reference-articles.json`. If that source repo requires authentication, set the fine-grained `COFFEE_ENGINE_READ_TOKEN` Actions secret with read-only Contents access to that repo; without access, the importer retains the last published snapshot. This is a separate reference corpus, not current news or automatic editorial input: source records without publication dates are not assigned to monthly news archives or shown as latest stories. The importer deduplicates normalized URLs and equivalent Open Journal Systems view/download routes; matching titles alone are not enough to discard a record.
ICO Robustas is not the ICE London futures contract. The feed stores its original value (US cents/lb), observation date, and source URL, plus a converted USD/metric-ton equivalent used by the calculator.
This feed does not create a synthetic history for ICO Robustas; do not infer a historical chart from the calculator equivalent.
JSON is committed back to repo
GitHub Pages serves updated JSON at same domain (no CORS!)
HTML fetches ./data/market-data.json via fetch() and renders Chart.js
📝 HTML Integration
Your HTML file uses:
JavaScript
Copy
fetch('./data/market-data.json')
  .then(r => r.json())
  .then(data => {
    // data.arabica.history[] → Chart.js
    // data.robusta.sourceValue → ICO Robustas in US cents/lb
    // data.robusta.sourceDate → date of the ICO observation
    // data.idrUsd.history[] → Chart.js
  });
Because HTML and JSON are on the same domain (*.github.io), no CORS issues!
⚠️ Limitations
Yahoo Finance API is unofficial and may change without notice
Free tier: no rate limits documented, but be respectful (6-hour interval is safe)
If Yahoo blocks requests, data falls back to last known values
For production reliability, consider upgrading to Barchart OnDemand or Alpha Vantage (paid APIs)
🔄 Data Update History
View all updates in commit history.
🌐 HTML Report
The public coffee news portal is available at both `/` (`index.html`) and `/kabar-kopi.html`. `scripts/templates/kabar-kopi.html` is the single UI source used by `scripts/generate-editorial-pages.js` to build both pages. Edit shared features in that template, not in just one generated page. `scripts/render-static-news.js` writes the same crawlable headline snapshot to both entrypoints, and `scripts/check-kabar-entrypoints.js` stops the data workflow and flags push/pull-request changes if they differ.

The public coffee news portal is kabar-kopi.html. Keep laporan-usda.html as a compatibility redirect for older links.
It fetches live data from:
plain
Copy
https://KGS-blog.github.io/Update-Coffee-Data/data/market-data.json
Make sure Update-Coffee-Data repo has GitHub Pages enabled.

## Kabar Kopi cluster review

AI cluster candidates appear in the **Klaster baru untuk ditinjau** panel on the Semua Berita Kopi tab. Editors can accept or reject a candidate there after signing in with the blog admin password. The decision is stored by the authenticated Cloudflare Worker in `KGS-blog/Blog/kabar-kopi-cluster-decisions.json`; the next scheduled portal-data run imports it into `data/cluster-decisions.json` and applies it to clustering. The decision can take up to six hours to appear in the processed feed.
