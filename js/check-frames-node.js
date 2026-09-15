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

// Uploading a file and then a folder must build one combined session.
function checkMerge(window) {
  const { mergeReports, parseHtmlDocument } = window.WxIngest;
  const batch = (docs, extra) => Object.assign({
    docs,
    images: [],
    pdfs: [],
    recconfs: [],
    warnings: [],
    errors: [],
    pendingImages: [],
    pendingPdfs: [],
    input: { mode: "files", ignoredFiles: 0, duplicateFiles: 0 }
  }, extra || {});

  const shell = parseHtmlDocument(OUTER, "Pulse-Creation date.html");
  const first = mergeReports(null, batch([shell]));
  assert.strictEqual(first.docs.length, 1, "First upload loads on its own");
  assert.strictEqual(first.carriedDocs, 0, "First upload carries nothing");
  assert.deepStrictEqual(Array.from(first.missingFrames), ["global_actions_list.html"],
    "The lone file is missing its frame");

  const grid = parseHtmlDocument(
    "<html><body><table><tr><th>Created</th></tr><tr><td>07-Sep-2026</td></tr></table></body></html>",
    "Pulse-Creation date_files/global_actions_list.html"
  );
  const second = mergeReports(first, batch([grid], { input: { mode: "folder", ignoredFiles: 12, duplicateFiles: 0 } }));
  assert.strictEqual(second.docs.length, 2, "The folder adds to the file already loaded");
  assert.strictEqual(second.addedDocs, 1, "One new page was added");
  assert.strictEqual(second.carriedDocs, 1, "One page was carried over");
  assert.deepStrictEqual(Array.from(second.missingFrames), [],
    "Adding the folder resolves the missing frame");
  assert.ok(second.docs.some((d) => d.name === "Pulse-Creation date.html"), "The original file is still loaded");

  // Re-adding the same page is ignored rather than duplicated.
  const third = mergeReports(second, batch([parseHtmlDocument(OUTER, "Pulse-Creation date.html")]));
  assert.strictEqual(third.docs.length, 2, "A repeat upload does not duplicate pages");
  assert.strictEqual(third.addedDocs, 0, "Nothing new was added");
  assert.strictEqual(third.input.duplicateFiles, 1, "The repeat is counted as a duplicate");

  // Images and PDFs accumulate, and only the new ones are queued for OCR.
  const img = (n) => new window.File(["x"], n, { type: "image/png" });
  const withImg = mergeReports(third, batch([], { images: [img("a.png")], pendingImages: [img("a.png")] }));
  assert.strictEqual(withImg.images.length, 1, "First image is kept");
  assert.strictEqual(withImg.pendingImages.length, 1, "First image is queued for OCR");
  const withTwo = mergeReports(withImg, batch([], { images: [img("a.png"), img("b.png")] }));
  assert.strictEqual(withTwo.images.length, 2, "Only the unseen image is added");
  assert.strictEqual(withTwo.pendingImages.length, 1, "Already-read images are not OCRed again");
  assert.strictEqual(withTwo.pendingImages[0].name, "b.png", "The new image is the queued one");
}

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

      checkMerge(window);
      console.log("Missing-frame and merge checks passed");
    } catch (err) {
      console.error(err.message || err);
      process.exit(1);
    }
  });
}).catch((e) => {
  console.error(e);
  process.exit(1);
});
