#!/usr/bin/env node
// A React app such as Jira ships almost no <label> and no title captions: it
// draws a field as a caption div beside a value div, and marks components with
// a test hook. Those hooks are the only attribute such an app maintains on
// purpose, so they must drive both the field names and the paths.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const code = fs.readFileSync(path.join(__dirname, "xpath.js"), "utf8");
const boot = new JSDOM("<!doctype html><html><body></body></html>", { runScripts: "outside-only" });
boot.window.eval(code);
const WxPath = boot.window.WxPath;

// Trimmed from a real saved Jira work item. Every quirk here is one the real
// page has: an empty edit button inside each caption, a person's name repeated
// for screen readers, names wrapped in a profile-card button, a profile hook
// reused for every person, and generated class names.
const page = new JSDOM(`<!doctype html><body>
<ol><li><a data-testid="issue.views.issue-base.foundation.breadcrumbs.current-issue.item"
      class="_6v24wadc css-1x103n1" href="/browse/CBE-55689"><span class="css-1gd7hga">CBE-55689</span></a></li></ol>

<div data-testid="issue.views.issue-base.foundation.status.status-field-wrapper">
  <button data-testid="issue-field-status.ui.status-view.status-button.status-button" aria-label="Done - Change status">
    <span data-testid="issue-field-status.ui.status-view.status-button.status-button--text" class="_11c8fhey">Done</span>
  </button>
</div>

<div data-testid="issue.issue-view-layout.issue-view-assignee-field.assignee">
  <div data-testid="issue-field-heading-styled-field-heading.assignee">
    <div><span>Assignee</span><button class="_2rko1qi0"></button></div>
  </div>
  <div>
    <div data-testid="issue.views.field.user.assignee">
      <div data-testid="profilecard-next.ui.profilecard.profilecard-trigger">
        <span role="button" aria-label="More information about Mahendra Joshi">
          <div role="img"><span>Mahendra Joshi</span></div>
          <span><span>Mahendra Joshi</span></span>
        </span>
      </div>
      <div role="button" data-testid="issue-view-layout-assignee-field.ui.assign-to-me">Assign to me</div>
    </div>
  </div>
</div>

<div data-testid="issue.issue-view-layout.issue-view-reporter-field.reporter">
  <div data-testid="issue-field-heading-styled-field-heading.reporter">
    <div><span>Reporter</span><button class="_2rko1qi0"></button></div>
  </div>
  <div>
    <div data-testid="profilecard-next.ui.profilecard.profilecard-trigger">
      <span role="button" aria-label="More information about Avinash Gutte">
        <div role="img"><span>Avinash Gutte</span></div>
        <span><span>Avinash Gutte</span></span>
      </span>
    </div>
  </div>
</div>

<div data-testid="issue-view-layout-group.common.ui.collapsible-group-factory.title">
  <div><span>More fields</span></div><div><span>Story Points, Original estimate</span></div>
</div>
<div><div><span>Collapse Attachments</span></div><div><span>Attachments</span></div></div>
<div data-testid="title-box-header"><div><span>TaskMiningClientLogs-2026072</span></div><div><span>2.0.zip</span></div></div>
<div data-testid="field-cmdb-object-lazy.ui.label.button-add"><button>Add object</button></div>
</body>`, { contentType: "text/html" });
const doc = page.window.document;

const url = "https://celonis.atlassian.net/browse/CBE-55689";
const fields = WxPath.collectFields(doc, { url });
const ranked = WxPath.rankFields(doc, fields);
const byLabel = (name) => ranked.find((f) => f.label.toLowerCase() === name.toLowerCase());

// 1. The four things a person reads off the top of the page must each become a
//    rule that returns exactly that value and nothing else.
[
  ["Record key", "CBE-55689"],
  ["Status", "Done"],
  ["Assignee", "Mahendra Joshi"],
  ["Reporter", "Avinash Gutte"]
].forEach(([label, expected]) => {
  const field = byLabel(label);
  assert.ok(field, label + " must be found, got " + JSON.stringify(ranked.map((f) => f.label)));
  assert.strictEqual(field.best.matchCount, 1,
    label + " must match one node, got " + field.best.matchCount + " via " + field.best.xpath);
  assert.strictEqual(field.best.sample, expected,
    label + " must read " + JSON.stringify(expected) + ", got " + JSON.stringify(field.best.sample) +
    " via " + field.best.xpath);
});

// 2. Reporter must not read the assignee. Both people carry the same
//    profile-card hook, so a path may only anchor on a hook used once.
const reporter = byLabel("Reporter");
assert.ok(!reporter.best.xpath.includes("profilecard"),
  "A hook shared by every person must not anchor a path: " + reporter.best.xpath);

// 3. Paths must not rest on class names a build tool generated.
ranked.forEach((f) => {
  assert.ok(!/css-[a-z0-9]{5,}|_[a-z0-9]{7,}/.test(f.best.xpath),
    f.key + " anchors on a generated class name: " + f.best.xpath);
});

// 4. A caption's own empty edit button must not disqualify the caption.
const captions = WxPath.captionRows(doc).map((r) => r.label);
assert.ok(captions.includes("Assignee"), "A caption holding an empty button is still a caption");

// 5. Page furniture must not pose as a field.
["More fields", "Collapse Attachments", "TaskMiningClientLogs-2026072"].forEach((junk) => {
  assert.ok(!byLabel(junk), JSON.stringify(junk) + " is not a field");
});
assert.ok(!ranked.some((f) => f.best.sample === "Add object"),
  "A button offering an action is not a value");

// 6. A name read off a test hook drops the scaffolding around it.
assert.strictEqual(WxPath.testIdLabel("issue-field-status.ui.status-view.status-button.status-button--text"), "status");
assert.strictEqual(WxPath.testIdLabel("issue.views.issue-base.foundation.breadcrumbs.current-issue.item"), "current issue");
assert.strictEqual(WxPath.testIdLabel("ui.view.container.wrapper"), null, "Scaffolding alone yields no name");

// 7. Two rules cannot share a key, because the key names the rule.
const keys = ranked.map((f) => f.key);
assert.strictEqual(keys.length, new Set(keys).size, "Keys must be unique, got " + keys.join(", "));

// 8. The record key comes from the URL, so it is absent without one.
assert.ok(!WxPath.rankFields(doc, WxPath.collectFields(doc)).some((f) => f.label === "Record key"),
  "Without a URL there is nothing to identify the record key by");

console.log("ok");
