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

["fileInput", "folderInput", "copyKeyBtn", "copyUrlBtn", "copyPathBtn", "copyRuleBtn"].forEach((id) => {
  assert.ok(doc.getElementById(id), `${id} must exist`);
});

assert.ok(doc.getElementById("fileInput").accept.includes(".zip"), "File picker must accept ZIP files");
assert.ok(doc.getElementById("fileInput").accept.includes(".html"), "File picker must accept HTML files");
assert.ok(doc.getElementById("folderInput").hasAttribute("webkitdirectory"), "Folder picker must select directories");

["copyKeyBtn", "copyUrlBtn", "copyPathBtn", "copyRuleBtn"].forEach((id) => {
  assert.ok(app.includes(`$("${id}").addEventListener`), `${id} must be wired`);
});
assert.ok(app.includes('if (navigator.clipboard && window.isSecureContext)'), "Copy must use the Clipboard API on HTTPS");
assert.ok(app.includes('document.execCommand("copy")'), "Copy must have a local fallback");
assert.ok(app.includes('"Key: " + rule.key'), "Full-rule copy must include the key");
assert.ok(app.includes('Path: " + rule.path'), "Full-rule copy must include the XPath");
assert.ok(app.includes('URL: " + rule.url'), "Full-rule copy must include the URL");

console.log("UI checks passed");
