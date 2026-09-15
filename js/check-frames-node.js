#!/usr/bin/env node
// A saved page keeps its iframes as separate files. These checks cover the warning
// shown when the outer .html arrives without them.
const assert = require("assert");
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");

const root = path.resolve(__dirname, "..");
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => {
  if (!/Could not parse CSS|Could not load/.test(e.message)) throw e;
});

const OUTER = `<html><head><title>Pulse</title></head><body>
  <iframe id="widget-203" src="./Pulse-Creation date_files/global_actions_list.html"></iframe>
  <iframe id="embed" src="./Pulse-Creation date_files/saved_resource.html"></iframe>
  <iframe src="about:blank"></iframe>
  <iframe src="https://cdn.example.com/remote.html"></iframe>
</body></html>`;

JSDOM.fromFile(path.join(root, "index.html"), {
  resources: "usable",
  runScripts: "dangerously",
  virtualConsole: vc
}).then((dom) => {
  const { window } = dom;
  window.addEventListener("load", () => {
    try {
      const { parseHtmlDocument, missingFrames } = window.WxIngest;
      // missingFrames returns an array from the jsdom realm, so copy it before comparing.
      const found = (docs) => Array.from(missingFrames(docs));
      const outer = parseHtmlDocument(OUTER, "Pulse-Creation date.html");

      assert.deepStrictEqual(found([outer]), ["global_actions_list.html"],
        "Only the real, local, uploaded-but-absent frame is reported");

      // Adding the folder resolves it, whatever the nesting.
      const child = parseHtmlDocument("<html><body><p>rows</p></body></html>",
        "Ops radar/Pulse-Creation date_files/global_actions_list.html");
      assert.deepStrictEqual(found([outer, child]), [],
        "A matching child page clears the warning regardless of its folder depth");

      // Percent-encoded and query-suffixed sources still match.
      const encoded = parseHtmlDocument(
        '<html><body><iframe src="./a%20b_files/global_actions_list.html#?__v=178886"></iframe></body></html>',
        "encoded.html"
      );
      assert.deepStrictEqual(found([encoded, child]), [],
        "Encoding, hash and query are stripped before matching");

      // Non-HTML frame targets are not reported.
      const pdfFrame = parseHtmlDocument(
        '<html><body><iframe src="./docs/report.pdf"></iframe></body></html>',
        "pdf.html"
      );
      assert.deepStrictEqual(found([pdfFrame]), [], "Non-HTML frame targets are ignored");

      // A page with no frames stays silent.
      const plain = parseHtmlDocument("<html><body><p>hi</p></body></html>", "plain.html");
      assert.deepStrictEqual(found([plain]), [], "A frameless page produces no warning");

      console.log("Missing-frame checks passed");
    } catch (err) {
      console.error(err.message || err);
      process.exit(1);
    }
  });
}).catch((e) => {
  console.error(e);
  process.exit(1);
});
