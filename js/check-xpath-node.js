const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const code = fs.readFileSync(path.join(__dirname, "xpath.js"), "utf8");
const boot = new JSDOM("<!doctype html><html><body></body></html>", { runScripts: "outside-only" });
boot.window.eval(code);
const WxPath = boot.window.WxPath;

const page = new JSDOM(`<!doctype html><body>
<div data-control-name="Planned Dispatch_DataCard2_1"><input class="datepicker-textbox" title="Planned Dispatch" value="9/8/2026"></div>
<div data-control-name="Procedure Type_DataCard2_1"><span class="topTagText_abc">NDA/BLA</span></div>
<div data-control-name="EditSubmission">Ops Radar Edit Submission Data Tracking-Number Compound Code</div>
</body>`, { contentType: "text/html" });
const doc = page.window.document;
const fields = WxPath.collectFields(doc);
const planned = fields.find((f) => /planned/i.test(f.label));
const proc = fields.find((f) => /procedure/i.test(f.label));
if (!planned || !proc) {
  console.error("fields", fields.map((f) => f.label + ":" + f.sample));
  process.exit(1);
}
const bestP = planned.paths.map((p) => WxPath.assessPath(doc, p)).sort((a, b) => b.score - a.score)[0];
const bestT = proc.paths.map((p) => WxPath.assessPath(doc, p)).sort((a, b) => b.score - a.score)[0];
console.log("planned", bestP.xpath, bestP.matchCount, bestP.sample, bestP.risks);
console.log("proc", bestT.xpath, bestT.matchCount, bestT.sample);
if (bestP.matchCount !== 1 || bestP.sample !== "9/8/2026") process.exit(2);
if (bestT.sample !== "NDA/BLA") process.exit(3);
console.log("ok");
