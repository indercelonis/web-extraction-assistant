#!/usr/bin/env node
/**
 * Build a single HTML file you can email or drop on Drive.
 * HTML / ZIP / folder extraction works when opened in Chrome or Edge
 * (file:// is OK). Screenshot OCR and PDF need the folder app + ./serve.sh.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function asScript(source, label) {
  const safe = source.replace(/<\/script/gi, "<\\/script");
  return `\n<script>\n/* ${label} */\n${safe}\n</script>\n`;
}

const fixtures = {};
for (const name of [
  "fixtures/sharepoint-edit-outer.html",
  "fixtures/powerapps-iframe.html",
  "fixtures/sharepoint-list.html",
  "fixtures/veeva.html"
]) {
  fixtures[name] = read(name);
}

const html = read("index.html")
  .replace(/<link rel="stylesheet" href="css\/app.css">/, `<style>\n${read("css/app.css")}\n</style>`)
  .replace(
    /<script src="vendor\/jszip.min.js"><\/script>[\s\S]*<script src="js\/app.js"><\/script>/,
    [
      asScript("window.WEA_SINGLE_FILE = true;", "single-file flag"),
      asScript("window.WEA_FIXTURES = " + JSON.stringify(fixtures) + ";", "sample pages"),
      asScript(read("vendor/jszip.min.js"), "vendor/jszip.min.js"),
      asScript(read("js/xpath.js"), "js/xpath.js"),
      asScript(read("js/ingest.js"), "js/ingest.js"),
      asScript(read("js/folder.js"), "js/folder.js"),
      asScript(read("js/export.js"), "js/export.js"),
      asScript(read("js/ocr.js"), "js/ocr.js"),
      asScript(read("js/selftest.js"), "js/selftest.js"),
      asScript(read("js/app.js"), "js/app.js")
    ].join("")
  )
  .replace(
    "Runs on this computer only",
    "One file · runs on this computer only"
  )
  .replace(
    "Bundled offline engines: JSZip (MIT), Tesseract.js (Apache-2.0), PDF.js (Apache-2.0). Customer files never leave this browser.",
    "One-file pack: HTML, ZIP, and folders work offline in this page. Screenshot OCR / PDF names need the full folder app. Customer files never leave this browser."
  );

const outName = process.argv[2] || path.join(root, "wea-single.html");
const out = path.isAbsolute(outName) ? outName : path.join(root, outName);
fs.writeFileSync(out, html);
const mb = (fs.statSync(out).size / (1024 * 1024)).toFixed(2);
console.log("Wrote", out, "(" + mb + " MB)");
