QBridge Coffee Market Data
Auto-updating live market data for coffee futures and IDR/USD exchange rate, deployed via GitHub Pages + GitHub Actions.
📊 Data Sources
Table
Asset	Symbol	Source	Unit
Arabica C-Market	KC=F	Yahoo Finance	cents/lb
Robusta London	RM=F	Yahoo Finance	USD/ton
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
fetch-prices.js calls Yahoo Finance API for KC=F, RM=F, IDR=X
Data is appended to data/market-data.json history array
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
    // data.robusta.history[] → Chart.js
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
The main report page is laporan-usda.html. Upload this to your GitHub Pages repo (e.g., Blog repo).
It fetches live data from:
plain
Copy
https://KGS-blog.github.io/Update-Coffee-Data/data/market-data.json
Make sure Update-Coffee-Data repo has GitHub Pages enabled.
