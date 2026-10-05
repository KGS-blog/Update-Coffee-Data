// Guard against the root homepage and the legacy /kabar-kopi.html URL drifting apart.
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const read = filename => fs.readFileSync(path.join(root, filename), "utf8");
const home = read("index.html");
const legacy = read("kabar-kopi.html");
if (home !== legacy) {
  console.error("Kabar Kopi entrypoints differ: index.html serves / while kabar-kopi.html is also public. Rebuild both from scripts/templates/kabar-kopi.html and render headlines into both before publishing.");
  process.exit(1);
}
console.log("Kabar Kopi root and /kabar-kopi.html are synchronized.");
