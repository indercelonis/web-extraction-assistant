#!/usr/bin/env node
// Web-component pages (Salesforce Lightning and similar) caption fields with a
// title attribute, and hide some values inside shadow roots. The first kind must
// become a rule; the second must be reported, never silently dropped.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const code = fs.readFileSync(path.join(__dirname, "xpath.js"), "utf8");
const boot = new JSDOM("<!doctype html><html><body></body></html>", { runScripts: "outside-only" });
boot.window.eval(code);
const WxPath = boot.window.WxPath;

// Trimmed from a real saved Salesforce case. Case Number renders into the page;
// Case Owner renders into a shadow root and leaves an empty tag behind.
const page = new JSDOM(`<!doctype html><body>
<div class="slds-page-header__detail-row">
  <records-highlights-details-item class="slds-page-header__detail-block">
    <div>
      <p class="slds-text-title slds-truncate" title="Case Number">Case Number</p>
      <p class="fieldComponent slds-text-body--regular"><slot><lightning-formatted-text>00449148</lightning-formatted-text></slot></p>
    </div>
  </records-highlights-details-item>
  <records-highlights-details-item class="slds-page-header__detail-block">
    <div>
      <p class="slds-text-title slds-truncate" title="Case Owner">Case Owner</p>
      <p class="fieldComponent slds-text-body--regular"><slot><force-owner-lookup></force-owner-lookup></slot></p>
    </div>
  </records-highlights-details-item>
</div>
<a href="/help" title="Get help">Support</a>
<img src="x.png" title="Avatar" alt="Avatar">
</body>`, { contentType: "text/html" });
const doc = page.window.document;

const fields = WxPath.collectFields(doc);
const byLabel = (name) => fields.find((f) => f.label === name);

// 1. A caption whose value is in the page becomes a field with a working path.
const number = byLabel("Case Number");
assert.ok(number, "Case Number must be detected from its title caption");
assert.strictEqual(number.key, "case_number", "Key is slugged from the caption");
const best = number.paths
  .map((p) => WxPath.assessPath(doc, p, number.element))
  .sort((a, b) => b.score - a.score)[0];
assert.strictEqual(best.matchCount, 1, "The best path must match exactly one node, got " + best.matchCount);
assert.strictEqual(best.sample, "00449148", "The path must return the value, got " + JSON.stringify(best.sample));

// 2. A caption whose value is in a shadow root must not pose as a usable field.
assert.ok(!byLabel("Case Owner"), "Case Owner has no readable value, so it must not be offered as a rule");

// 3. It must still be reported, with the component that swallowed it.
const gaps = WxPath.shadowGaps(doc);
const owner = gaps.find((g) => g.label === "Case Owner");
assert.ok(owner, "Case Owner must be reported as unreadable, got " + JSON.stringify(gaps));
assert.strictEqual(owner.component, "force-owner-lookup", "The report names the component");
assert.ok(!gaps.some((g) => g.label === "Case Number"), "A field that works must not be called unreadable");

// 4. Tooltips are not captions: a link or image title must not invent a field.
assert.ok(!byLabel("Get help"), "A link tooltip must not become a field");
assert.ok(!byLabel("Avatar"), "An image tooltip must not become a field");

// 5. Captions count towards richness, so a page like this outranks a login frame.
assert.ok(WxPath.documentRichness(doc) >= 2, "Title captions must count towards richness");

console.log("ok");
