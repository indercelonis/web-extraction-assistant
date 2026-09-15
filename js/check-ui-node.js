#!/usr/bin/env node
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const app = fs.readFileSync(path.join(root, "js/app.js"), "utf8");
const dom = new JSDOM(html);
const doc = dom.window.document;

const ids = Array.from(doc.querySelectorAll("[id]")).map((el) => el.id);
assert.strictEqual(new Set(ids).size, ids.length, "Every element ID must be unique");

["fileInput", "folderInput", "addBtn", "addMenu", "pickFilesBtn", "pickFolderBtn", "resetBtn", "copyKeyBtn", "copyUrlBtn", "copyPathBtn", "copyRuleBtn"].forEach((id) => {
  assert.ok(doc.getElementById(id), `${id} must exist`);
});

assert.ok(doc.getElementById("fileInput").accept.includes(".zip"), "File picker must accept ZIP files");
assert.ok(doc.getElementById("fileInput").accept.includes(".html"), "File picker must accept HTML files");
assert.ok(doc.getElementById("folderInput").hasAttribute("webkitdirectory"), "Folder picker must select directories");

// One visible button must cover files, folders and ZIPs.
const uploadButtons = Array.from(doc.querySelectorAll(".drop-actions > .btn, .drop-actions > .add-menu-wrap > .btn"))
  .filter((el) => el.id !== "demoBtn" && el.id !== "resetBtn");
assert.strictEqual(uploadButtons.length, 1, "The dropzone must expose exactly one upload button");
assert.strictEqual(uploadButtons[0].id, "addBtn", "That button must be addBtn");
assert.strictEqual(doc.getElementById("addBtn").getAttribute("aria-expanded"), "false", "Menu must start collapsed");
assert.ok(doc.getElementById("addMenu").classList.contains("hidden"), "Menu markup must start hidden");
assert.strictEqual(doc.querySelectorAll("#addMenu .add-menu-item").length, 3,
  "Menu must offer folder, paired and file routes");
assert.ok(doc.getElementById("pickPairBtn"), "The paired route must exist");
assert.ok(app.includes("state.pairing = true"), "The paired route must arm the follow-up prompt");
assert.ok(app.includes("data-action='add-folder'"), "The missing-frame alert must offer a folder button");
assert.ok(
  !doc.querySelector('label > input[type="file"]'),
  "File inputs must be standalone so the menu drives them"
);

["addBtn", "pickFilesBtn", "pickFolderBtn"].forEach((id) => {
  assert.ok(app.includes(`$("${id}")`) || app.includes(`on("${id}"`), `${id} must be wired`);
});
assert.ok(app.includes('$("folderInput").click()'), "Folder route must open the directory picker");
assert.ok(app.includes('$("fileInput").click()'), "File route must open the file picker");
assert.ok(app.includes("bindAddMenu()"), "The add menu must be initialised");

// Uploads must accumulate, so a folder and a stray file can be combined.
assert.ok(doc.getElementById("resetBtn").classList.contains("hidden"), "Start over begins hidden");
assert.ok(app.includes('on("resetBtn", "click", startOver)'), "Start over must be wired");
assert.notStrictEqual(doc.getElementById("resetBtn"), doc.getElementById("clearBtn"),
  "Start over must not collide with the export Clear all");
assert.ok(app.includes("WxIngest.mergeReports(state.report, fresh)"), "Uploads must merge into the session");

const handleFiles = app.slice(app.indexOf("async function handleFiles"), app.indexOf("function addSummary"));
assert.ok(handleFiles.length > 200, "handleFiles body must be found");
assert.ok(!handleFiles.includes("state.accepted = []"), "A further upload must not discard saved rules");
assert.ok(!handleFiles.includes("state.ocr = []"), "A further upload must not discard OCR results");
assert.ok(handleFiles.includes("report.pendingImages"), "Only newly added images may be re-OCRed");

// index.html and the scripts are cached separately, so they must be versioned together.
const build = doc.getElementById("buildId");
assert.ok(build, "The page must carry a build stamp");
const stamp = build.textContent.trim();
assert.ok(app.includes(`const BUILD = "${stamp}"`), "app.js must agree with the page build stamp");
Array.from(doc.querySelectorAll('script[src^="js/"], link[rel="stylesheet"]')).forEach((el) => {
  const url = el.getAttribute("src") || el.getAttribute("href");
  assert.ok(url.endsWith("?v=" + stamp), `${url} must be cache-busted to build ${stamp}`);
});
assert.ok(app.includes("checkBuild()"), "A stale page must be reported to the user");

// Controls added after launch must not throw on a cached page.
assert.ok(!app.includes('$("resetBtn").classList'), "resetBtn must be accessed defensively");
assert.ok(!app.includes('$("resetBtn").addEventListener'), "resetBtn must be bound defensively");

["copyKeyBtn", "copyUrlBtn", "copyPathBtn", "copyRuleBtn"].forEach((id) => {
  assert.ok(app.includes(`$("${id}").addEventListener`), `${id} must be wired`);
});
assert.ok(app.includes('if (navigator.clipboard && window.isSecureContext)'), "Copy must use the Clipboard API on HTTPS");
assert.ok(app.includes('document.execCommand("copy")'), "Copy must have a local fallback");
assert.ok(app.includes('"Key: " + rule.key'), "Full-rule copy must include the key");
assert.ok(app.includes('Path: " + rule.path'), "Full-rule copy must include the XPath");
assert.ok(app.includes('URL: " + rule.url'), "Full-rule copy must include the URL");

console.log("UI checks passed");
