#!/usr/bin/env node
// Drives the real page: upload a lone HTML file, then the folder it belongs to,
// and confirm the session accumulates instead of starting again.
const assert = require("assert");
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");

const root = path.resolve(__dirname, "..");
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => {
  if (!/Could not parse CSS|Could not load/.test(e.message)) throw e;
});

const SHELL = `<html><head><title>Pulse</title></head><body>
  <iframe id="widget-203" src="./Pulse_files/global_actions_list.html"></iframe>
  <label for="q">Filter</label><input id="q" title="Filter" value="open">
</body></html>`;

const GRID = `<html><head><title>Global actions</title></head><body>
  <table class="grid">
    <tr><th>Study code</th><th>Creation date</th></tr>
    <tr><td>DAK539A12303</td><td>07-Sep-2026</td></tr>
  </table>
</body></html>`;

const STYLE = "body { color: #333 }";

function settle(window, times) {
  // Let the async handleFiles chain finish.
  return new Promise((resolve) => {
    let left = times;
    const tick = () => (left-- > 0 ? window.setTimeout(tick, 0) : resolve());
    tick();
  });
}

JSDOM.fromFile(path.join(root, "index.html"), {
  resources: "usable",
  runScripts: "dangerously",
  virtualConsole: vc
}).then((dom) => {
  const { window } = dom;
  window.addEventListener("load", async () => {
    try {
      const doc = window.document;
      const $ = (id) => doc.getElementById(id);

      const make = (name, body, type, relPath) => {
        const f = new window.File([body], name.split("/").pop(), { type: type || "text/html" });
        // jsdom's Blob has no text(); browsers do.
        if (typeof f.text !== "function") f.text = () => Promise.resolve(body);
        if (relPath) Object.defineProperty(f, "webkitRelativePath", { value: relPath });
        return f;
      };
      const feed = (input, files) => {
        Object.defineProperty(input, "files", { configurable: true, value: files });
        input.dispatchEvent(new window.Event("change", { bubbles: true }));
      };

      // 1. A lone HTML file.
      feed($("fileInput"), [make("Pulse.html", SHELL)]);
      await settle(window, 40);

      // docCount reads "N" or "N of M" while empty pages are hidden.
      const pages = () => {
        const nums = $("docCount").textContent.match(/\d+/g) || ["0"];
        return Number(nums[nums.length - 1]);
      };

      assert.strictEqual(pages(), 1, "One page after the first upload");
      assert.ok(/not loaded/.test($("warnBox").textContent),
        "The missing sub-page is called out: " + $("warnBox").textContent.slice(0, 120));
      assert.ok(!$("resetBtn").classList.contains("hidden"), "Start over appears once pages are loaded");

      // Save a rule so we can prove the next upload does not wipe it.
      $("keyInput").value = "shell_filter";
      $("pathInput").value = "//input[@id='q']/@value";
      $("urlInput").value = "pulse.novartis.intra";
      $("acceptBtn").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      const savedRules = Number($("ruleCount").textContent);
      assert.ok(savedRules >= 1, "A rule was saved");

      // 2. Now the folder, which also carries non-HTML assets.
      feed($("folderInput"), [
        make("Pulse.html", SHELL, "text/html", "Pulse_files_root/Pulse.html"),
        make("global_actions_list.html", GRID, "text/html", "Pulse_files_root/Pulse_files/global_actions_list.html"),
        make("main.css", STYLE, "text/css", "Pulse_files_root/Pulse_files/main.css")
      ]);
      await settle(window, 40);

      assert.strictEqual(pages(), 2, "The folder adds the grid page and keeps the first file");
      assert.ok(!/not loaded/.test($("warnBox").textContent),
        "The missing sub-page warning clears once the folder is added");
      assert.strictEqual(Number($("ruleCount").textContent), savedRules,
        "Saved rules survive the second upload");
      assert.ok(/Added 1 page/.test($("status").textContent),
        "The status reports what was added: " + $("status").textContent);
      assert.ok(/ignored 1 non-HTML/.test($("status").textContent),
        "The status reports ignored assets: " + $("status").textContent);

      // 3. Re-adding the same folder changes nothing.
      feed($("folderInput"), [
        make("global_actions_list.html", GRID, "text/html", "Pulse_files_root/Pulse_files/global_actions_list.html")
      ]);
      await settle(window, 40);
      assert.strictEqual(pages(), 2, "A repeat upload does not duplicate pages");
      assert.ok(/Nothing new/.test($("status").textContent),
        "The status says nothing new: " + $("status").textContent);

      // 4. Start over really does clear.
      $("resetBtn").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      await settle(window, 10);
      assert.strictEqual(pages(), 0, "Start over clears the pages");
      assert.strictEqual($("ruleCount").textContent, "0", "Start over clears the saved rules");
      assert.ok($("resetBtn").classList.contains("hidden"), "Start over hides itself again");

      console.log("Session checks passed");
    } catch (err) {
      console.error(err.message || err);
      process.exit(1);
    }
  });
}).catch((e) => {
  console.error(e);
  process.exit(1);
});
