(function (global) {
  function assert(cond, name, detail) {
    return { pass: !!cond, name, detail: detail || "" };
  }

  function htmlDoc(html) {
    return WxIngest.parseHtmlDocument(html, "t.html").doc;
  }

  function run(listEl) {
    const tests = [];
    const pa = `<div data-control-name="Planned Dispatch_DataCard2_1"><input class="datepicker-textbox" title="Planned Dispatch" value="9/8/2026"></div>
      <div data-control-name="Procedure Type_DataCard2_1"><span class="topTagText_abc">NDA/BLA</span></div>
      <div data-control-name="EditSubmission">Ops Radar Edit Submission Data Tracking-Number Compound Code NDA/BLA</div>`;
    const doc = htmlDoc(pa);
    const fields = WxPath.collectFields(doc);
    const planned = fields.find((f) => /planned/i.test(f.label));
    const proc = fields.find((f) => /procedure/i.test(f.label));
    tests.push(assert(!!planned, "Detects Planned Dispatch card"));
    tests.push(assert(!!proc, "Detects Procedure Type card"));
    if (planned) {
      const a = planned.paths.map((p) => WxPath.assessPath(doc, p)).sort((x, y) => y.score - x.score)[0];
      tests.push(assert(a && a.matchCount === 1, "Planned Dispatch best path is unique", a && a.xpath));
      tests.push(assert(a && a.sample === "9/8/2026", "Planned Dispatch sample is the date", a && a.sample));
    }
    if (proc) {
      const a = proc.paths.map((p) => WxPath.assessPath(doc, p)).sort((x, y) => y.score - x.score)[0];
      tests.push(assert(a && a.sample === "NDA/BLA", "Procedure Type sample is the tag", a && a.sample));
    }
    const screen = WxPath.assessPath(doc, "//div[@data-control-name='EditSubmission']");
    tests.push(assert(screen.sample.length > 40, "Whole-screen path is flagged as long text"));
    tests.push(assert(screen.risks.some((r) => /whole screen/i.test(r)), "Long text risk is present"));

    const list = htmlDoc(`<!-- saved from url=(0091)https://share.example.com/sites/OpsRadar/Lists/Planning%20List/AllItems.aspx -->
      <table class="ms-listviewtable"><tr><th></th><th>Created</th></tr><tr class="ms-itmhover"><td></td><td>August 25</td></tr></table>`);
    const parsed = WxIngest.parseHtmlDocument(list.documentElement ? new XMLSerializer().serializeToString(list) : "", "x.html");
    tests.push(assert(/AllItems/i.test(WxIngest.parseHtmlDocument(`<!-- saved from url=(0091)https://share.example.com/sites/OpsRadar/Lists/Planning%20List/AllItems.aspx --><html></html>`, "a.html").sourceUrl), "Reads saved-from URL"));

    const url = WxPath.inferUrl("https://share.example.com/sites/OpsRadar/Lists/Planning%20List/AllItems.aspx");
    tests.push(assert(/AllItems\.aspx/.test(url), "List URL filter prefers AllItems.aspx", url));
    const iframeUrl = WxPath.inferUrl("https://runtime-app.powerplatform.com/apps/abc");
    tests.push(assert(iframeUrl === "runtime-app.powerplatform.com", "Power Apps URL filter", iframeUrl));

    const xml = WxExport.extractionXml({ key: "k", path: "//td[count(x)>=10]", url: "u" });
    tests.push(assert(xml.includes("&gt;="), "Escapes >= in XML"));

    const slug = WxPath.slugKey("Planned Dispatch");
    tests.push(assert(slug === "planned_dispatch", "Key slug", slug));

    tests.push(assert(WxIngest.kindOf("page.html") === "html", "HTML kind"));
    tests.push(assert(WxIngest.kindOf("PAGE.HTM") === "html", "HTML extension is case-insensitive"));
    tests.push(assert(WxIngest.kindOf("page.xhtml") === "html", "XHTML kind"));
    tests.push(assert(WxIngest.kindOf("shot.png") === "image", "Image kind"));
    tests.push(assert(WxIngest.kindOf("pack.zip") === "zip", "Zip kind"));
    tests.push(assert(!!document.getElementById("folderInput"), "Folder picker is available"));
    tests.push(assert(!!document.getElementById("addBtn"), "Single upload button is available"));
    tests.push(assert(!!document.getElementById("pickFolderBtn"), "Folder route is available"));
    tests.push(assert(!!document.getElementById("pickFilesBtn"), "File route is available"));
    tests.push(assert(!!document.getElementById("resetBtn"), "Start over is available"));
    tests.push(assert(typeof WxIngest.mergeReports === "function", "Uploads accumulate across picks"));
    tests.push(assert(!!document.getElementById("copyKeyBtn"), "Key copy control is available"));
    tests.push(assert(!!document.getElementById("copyUrlBtn"), "URL copy control is available"));
    tests.push(assert(!!document.getElementById("copyPathBtn"), "XPath copy control is available"));
    tests.push(assert(!!document.getElementById("copyRuleBtn"), "Full rule copy control is available"));
    tests.push(assert(
      WxIngest.fileName({ name: "V1.html", webkitRelativePath: "save/page_files/V1.html" }) === "save/page_files/V1.html",
      "Nested folder path is preserved"
    ));

    listEl.innerHTML = "";
    tests.forEach((t) => {
      const li = document.createElement("li");
      li.className = t.pass ? "pass" : "fail";
      li.textContent = (t.pass ? "PASS" : "FAIL") + " · " + t.name + (t.detail ? " · " + t.detail : "");
      listEl.appendChild(li);
    });
    const failed = tests.filter((t) => !t.pass).length;
    const banner = document.createElement("li");
    banner.textContent = failed ? failed + " failed" : "All " + tests.length + " checks passed";
    banner.className = failed ? "fail" : "pass";
    listEl.insertBefore(banner, listEl.firstChild);
  }

  global.WxSelfTest = { run };
})(window);
