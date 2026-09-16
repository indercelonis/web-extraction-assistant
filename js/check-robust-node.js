#!/usr/bin/env node
// Awkward pages must not throw, hang, or hand back a rule that quietly reads
// the wrong thing. Where no dependable path exists the tool must say so rather
// than offer a confident guess, because a rule that looks right and is wrong
// costs more than one that is plainly weak.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const boot = new JSDOM("<!doctype html><html><body></body></html>", { runScripts: "outside-only" });
boot.window.eval(fs.readFileSync(path.join(__dirname, "xpath.js"), "utf8"));
const WxPath = boot.window.WxPath;

function rank(html, url) {
  const doc = new JSDOM(html, { contentType: "text/html" }).window.document;
  return WxPath.rankFields(doc, WxPath.collectFields(doc, url ? { url } : undefined));
}
const find = (ranked, key) => ranked.find((f) => f.key === key);

// A document with nothing to offer must come back empty, not broken.
["<!doctype html><html><body></body></html>",
  "<!doctype html><body>just words</body>",
  "<!doctype html><body><div><span>Name<div>Ada",
  "<!doctype html><body><div></div><span></span></body>",
  "<!doctype html><body>" + "<div>".repeat(300) + "<span>Deep</span>" + "</div>".repeat(300) + "</body>"
].forEach((html, i) => {
  const ranked = rank(html);
  assert.ok(Array.isArray(ranked), "Document " + i + " must still produce a list");
});

// Quotes in a hook or a caption must survive into a working path. An XPath
// literal cannot hold both kinds of quote, so this is where paths break.
const quoted = rank(`<body><div data-testid="issue's-field.name"><span>Ada</span></div></body>`);
const quotedField = quoted.find((f) => f.best.sample === "Ada");
assert.ok(quotedField, "A hook holding an apostrophe must still yield the value");
assert.strictEqual(quotedField.best.matchCount, 1,
  "A hook holding an apostrophe must match once, got " + quotedField.best.xpath);

const dquoted = rank(`<body><div data-testid='say "hi" field'><span>Ada</span></div></body>`);
assert.ok(dquoted.some((f) => f.best.sample === "Ada" && f.best.matchCount === 1),
  "A hook holding a double quote must still yield the value");

const apostrophe = rank(`<body><div><div><span>Owner's name</span></div><div><span>Ada</span></div></div></body>`);
assert.strictEqual((find(apostrophe, "owner_s_name") || {}).best.sample, "Ada",
  "A caption holding an apostrophe must read its value");

// Where a page repeats a hook there is no path to one of them. The tool must
// report the ambiguity and refuse to call it high confidence.
const repeated = rank("<body>" + Array.from({ length: 20 }, (_, i) =>
  `<div data-testid="row.field.person"><span>Person ${i}</span></div>`).join("") + "</body>");
repeated.forEach((f) => {
  if (f.best.matchCount === 1) return;
  assert.notStrictEqual(f.best.confidence, "high",
    f.key + " matches " + f.best.matchCount + " nodes and must not be called high confidence");
  assert.ok(f.best.risks.some((r) => /not tied to one field/.test(r)),
    f.key + " must say that it matches more than one node, got " + JSON.stringify(f.best.risks));
});

// A caption with an empty value must not pass the label off as the value.
const empty = rank(`<body><div data-testid="x.field.name"><div><span>Name</span></div><div></div></div></body>`);
assert.ok(!empty.some((f) => f.best.sample === "Name" && f.best.confidence === "high"),
  "An empty field must not report its own label as a confident value");

// The record key is read from the URL, so it may not be invented without one,
// nor when the page never prints it.
assert.ok(!find(rank(`<body><h1 data-testid="page.summary.heading">Order 12345</h1></body>`), "record_key"),
  "With no URL there is nothing to identify a record key by");
assert.ok(!find(rank("<body><div>nothing matching</div></body>", "https://example.com/browse/ABC-1"), "record_key"),
  "A URL segment the page never prints is not a field");

// Shapes the tool handled before must keep working.
assert.strictEqual((find(rank(`<body><table><tr><td>Owner</td><td>Ada</td></tr></table></body>`), "owner") || {}).best.sample,
  "Ada", "A two-column table row must still work");
assert.strictEqual((find(rank(`<body><div><p title="Case Number">Case Number</p><p><span>00449148</span></p></div></body>`), "case_number") || {}).best.sample,
  "00449148", "A title caption must still work");
assert.strictEqual((find(rank(`<body><p><strong>Study Code:</strong><span>DAK539</span></p></body>`), "study_code") || {}).best.sample,
  "DAK539", "A bold caption must still work");
assert.ok(find(rank(`<body><label for="n">Customer</label><input id="n" value="Ada"></body>`), "customer"),
  "A plain label must still work");

// Salesforce draws a record two ways: the caption and value as siblings, and
// each in its own box. A lookup field such as Case Owner or Contact Name
// prints its value as a link to the record it points at, which must be read
// as a value, while a button sitting in an empty field is an action.
function salesforce(valueMarkup, wrapped) {
  const caption = `<p title="Contact Name" class="fieldLabel">Contact Name</p>`;
  const value = `<p class="fieldComponent">` + valueMarkup + `</p>`;
  return "<body>" + (wrapped
    ? `<div class="slds-form-element"><div class="label">${caption}</div><div class="control">${value}</div></div>`
    : `<div class="slds-form-element">${caption}${value}</div>`) + "</body>";
}
[["a link", `<a href="/lightning/r/Contact/003/view">Ada Lovelace</a>`],
  ["plain text", `<span>Ada Lovelace</span>`]
].forEach(([shape, markup]) => {
  [false, true].forEach((wrapped) => {
    const where = shape + (wrapped ? ", caption in its own box" : ", caption beside the value");
    const field = find(rank(salesforce(markup, wrapped)), "contact_name");
    assert.ok(field, "A lookup field drawn as " + where + " must be found");
    assert.strictEqual(field.best.sample, "Ada Lovelace",
      "A lookup field drawn as " + where + " must read its value, got " +
      JSON.stringify(field.best.sample) + " via " + field.best.xpath);
    assert.strictEqual(field.best.matchCount, 1,
      "A lookup field drawn as " + where + " must match one node, got " + field.best.xpath);
  });
});

// Where the value is a component that rendered into a shadow root, the saved
// page holds an empty tag. No path can read it, in this tool or in Task
// Mining, so the field must be named and reported rather than left out.
[false, true].forEach((wrapped) => {
  const html = salesforce(`<slot><force-owner-lookup></force-owner-lookup></slot>`, wrapped)
    .replace(/Contact Name/g, "Case Owner");
  const doc = new JSDOM(html, { contentType: "text/html" }).window.document;
  const gaps = WxPath.shadowGaps(doc);
  const where = wrapped ? " when the caption sits in its own box" : "";
  assert.strictEqual(gaps.length, 1,
    "A value left behind in a shadow root must be reported once" + where + ", got " + JSON.stringify(gaps));
  assert.strictEqual(gaps[0].label, "Case Owner", "The lost field must be named" + where);
  assert.strictEqual(gaps[0].component, "force-owner-lookup",
    "The report must name the component that swallowed the value" + where);
  assert.ok(!find(WxPath.rankFields(doc, WxPath.collectFields(doc)), "case_owner"),
    "A value no path can reach must not be offered as a rule");
});

// A button standing in an empty field is an action, not a value.
assert.ok(!rank(`<body><div><div><span>Object</span></div><div><button>Add object</button></div></div></body>`)
  .some((f) => f.best.sample === "Add object"), "A button offering an action is not a value");

// Many fields on one page must stay correct, and ranking must stay bounded.
const many = "<body>" + Array.from({ length: 30 }, (_, i) =>
  `<div data-testid="row${i}.field.v"><div><span>Field ${i}</span></div><div><span>Value ${i}</span></div></div>`).join("") + "</body>";
const scaled = rank(many);
assert.strictEqual((find(scaled, "field_7") || {}).best.sample, "Value 7",
  "A field in the middle of a long page must still read correctly");

console.log("ok");
