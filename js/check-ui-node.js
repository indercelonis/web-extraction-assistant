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

["fileInput", "folderInput", "addBtn", "addMenu", "pickFilesBtn", "pickFolderBtn", "copyKeyBtn", "copyUrlBtn", "copyPathBtn", "copyRuleBtn"].forEach((id) => {
  assert.ok(doc.getElementById(id), `${id} must exist`);
});

assert.ok(doc.getElementById("fileInput").accept.includes(".zip"), "File picker must accept ZIP files");
assert.ok(doc.getElementById("fileInput").accept.includes(".html"), "File picker must accept HTML files");
assert.ok(doc.getElementById("folderInput").hasAttribute("webkitdirectory"), "Folder picker must select directories");

// One visible button must cover files, folders and ZIPs.
const uploadButtons = Array.from(doc.querySelectorAll(".drop-actions > .btn, .drop-actions > .add-menu-wrap > .btn"))
  .filter((el) => el.id !== "demoBtn");
assert.strictEqual(uploadButtons.length, 1, "The dropzone must expose exactly one upload button");
assert.strictEqual(uploadButtons[0].id, "addBtn", "That button must be addBtn");
assert.strictEqual(doc.getElementById("addBtn").getAttribute("aria-expanded"), "false", "Menu must start collapsed");
assert.ok(doc.getElementById("addMenu").classList.contains("hidden"), "Menu markup must start hidden");
assert.strictEqual(doc.querySelectorAll("#addMenu .add-menu-item").length, 2, "Menu must offer folder and file routes");
assert.ok(
  !doc.querySelector('label > input[type="file"]'),
  "File inputs must be standalone so the menu drives them"
);

["addBtn", "pickFilesBtn", "pickFolderBtn"].forEach((id) => {
  assert.ok(app.includes(`$("${id}")`), `${id} must be wired`);
});
assert.ok(app.includes('$("folderInput").click()'), "Folder route must open the directory picker");
assert.ok(app.includes('$("fileInput").click()'), "File route must open the file picker");
assert.ok(app.includes("bindAddMenu()"), "The add menu must be initialised");

["copyKeyBtn", "copyUrlBtn", "copyPathBtn", "copyRuleBtn"].forEach((id) => {
  assert.ok(app.includes(`$("${id}").addEventListener`), `${id} must be wired`);
});
assert.ok(app.includes('if (navigator.clipboard && window.isSecureContext)'), "Copy must use the Clipboard API on HTTPS");
assert.ok(app.includes('document.execCommand("copy")'), "Copy must have a local fallback");
assert.ok(app.includes('"Key: " + rule.key'), "Full-rule copy must include the key");
assert.ok(app.includes('Path: " + rule.path'), "Full-rule copy must include the XPath");
assert.ok(app.includes('URL: " + rule.url'), "Full-rule copy must include the URL");

console.log("UI checks passed");
