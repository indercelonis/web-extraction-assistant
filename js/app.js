(function () {
  const state = {
    report: null,
    docIndex: -1,
    fields: [],
    fieldIndex: -1,
    alts: [],
    accepted: [],
    ocr: [],
    recconfRaw: "",
    pairing: false
  };

  const BUILD = "5";

  const $ = (id) => document.getElementById(id);

  /* A cached index.html paired with fresh scripts must degrade, not throw
     halfway through an upload. */
  function setHidden(id, hidden) {
    const el = $(id);
    if (el) el.classList.toggle("hidden", hidden);
  }
  function on(id, event, fn) {
    const el = $(id);
    if (el) el.addEventListener(event, fn);
  }

  const ICON = {
    page: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>',
    frame: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>',
    input: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="10" rx="2"/><path d="M6 11v2"/></svg>',
    table: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/></svg>',
    text: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7V5h16v2"/><path d="M12 5v14"/><path d="M9 19h6"/></svg>'
  };

  /* ---------------- helpers ---------------- */

  function busy(on, msg) {
    $("spinner").classList.toggle("hidden", !on);
    if (msg !== undefined) $("status").textContent = msg;
  }

  function setStatus(msg) {
    $("status").textContent = msg || "";
  }

  async function copyText(text, label) {
    const value = String(text || "");
    if (!value.trim()) {
      setStatus("Nothing to copy.");
      return false;
    }
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(value);
      } else {
        const area = document.createElement("textarea");
        area.value = value;
        area.setAttribute("readonly", "");
        area.style.position = "fixed";
        area.style.opacity = "0";
        document.body.appendChild(area);
        area.select();
        if (!document.execCommand("copy")) throw new Error("Copy command failed");
        area.remove();
      }
      setStatus(label + " copied.");
      return true;
    } catch (err) {
      setStatus("Could not copy automatically. Select the text and copy it manually.");
      return false;
    }
  }

  function ruleText(rule) {
    return "Key: " + rule.key + "\nPath: " + rule.path + "\nURL: " + rule.url;
  }

  function setSteps() {
    const has = { 1: !!(state.report && state.report.docs.length), 2: state.fieldIndex >= 0, 3: !!$("pathInput").value.trim(), 4: state.accepted.length > 0 };
    [1, 2, 3, 4].forEach((n) => {
      const el = $("step" + n);
      el.classList.remove("active", "done");
      if (has[n]) el.classList.add("done");
    });
    const next = [1, 2, 3, 4].find((n) => !has[n]) || 4;
    $("step" + next).classList.remove("done");
    $("step" + next).classList.add("active");
  }

  function confClass(c) {
    return c === "high" ? "ok" : c === "medium" ? "warn" : "bad";
  }

  function escapeHtml(text) {
    return String(text || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function alertHtml(kind, text, trustedHtml) {
    const icon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4"/><path d="M12 17h.01"/><circle cx="12" cy="12" r="9"/></svg>';
    return '<div class="alert ' + kind + '">' + icon + "<span>" + (trustedHtml ? text : escapeHtml(text)) + "</span></div>";
  }

  /* ---------------- documents ---------------- */

  function renderDocs() {
    const all = (state.report && state.report.docs) || [];
    const hide = $("hideEmpty").checked;
    const docs = hide ? all.filter((d) => !d.isHelper) : all;
    const list = $("fileList");
    list.innerHTML = "";
    $("docCount").textContent = hide ? docs.length + " of " + all.length : String(all.length);
    $("fileEmpty").classList.toggle("hidden", docs.length > 0);
    if (!docs.length && all.length) {
      $("fileEmpty").textContent = "All " + all.length + " files are helper frames with no fields. Untick “Hide empty” to see them.";
    }

    docs.forEach((d) => {
      const i = all.indexOf(d);
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button";
      if (i === state.docIndex) btn.classList.add("active");
      btn.innerHTML =
        '<span class="ico">' + (d.isIframe ? ICON.frame : ICON.page) + "</span>" +
        '<span class="txt"><span class="t1"></span><span class="t2"></span></span>' +
        '<span class="pill ' + (d.richness > 0 ? "ok" : "") + '">' + d.richness + "</span>";
      btn.querySelector(".t1").textContent = d.name.split("/").pop();
      btn.querySelector(".t2").textContent = d.kindLabel + (d.urlHint ? " · " + d.urlHint : "");
      btn.addEventListener("click", () => selectDoc(i));
      li.appendChild(btn);
      list.appendChild(li);
    });
  }

  function selectDoc(i) {
    state.docIndex = i;
    const doc = state.report.docs[i];
    state.fields = WxPath.rankFields(doc.doc, WxPath.collectFields(doc.doc));
    $("docTitle").textContent = doc.title || doc.name;
    $("docMeta").textContent = doc.sourceUrl ? "Saved from " + doc.sourceUrl : "No source URL found in this file. Set the URL filter by hand.";

    const pills = [];
    pills.push('<span class="pill ' + (doc.isIframe ? "accent" : "") + '">' + doc.kindLabel + "</span>");
    if (doc.urlHint) pills.push('<span class="pill">' + doc.urlHint + "</span>");
    pills.push('<span class="pill ' + (state.fields.length ? "ok" : "bad") + '">' + state.fields.length + " fields</span>");
    $("docPills").innerHTML = pills.join("");

    $("urlHint").value = doc.urlHint || "";
    $("urlInput").value = doc.urlHint || "";
    renderDocs();
    renderFields();
    if (state.fields.length) {
      selectField(0);
    } else {
      clearDetail();
      $("whyBox").textContent = doc.isHelper
        ? "This file is a helper frame Chrome saved alongside the page. It has no fields. Pick a page with a green count."
        : "No labels, table headers or form controls were found in this file. The real content may be in an inner frame such as V1.html.";
    }
    setSteps();
  }

  /* ---------------- fields ---------------- */

  function fieldIcon(f) {
    const tag = f.element && f.element.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return ICON.input;
    if (tag === "TH" || tag === "TD") return ICON.table;
    return ICON.text;
  }

  function renderFields() {
    const list = $("fieldList");
    list.innerHTML = "";
    $("fieldCount").textContent = String(state.fields.length);
    $("fieldEmpty").classList.toggle("hidden", state.fields.length > 0);

    state.fields.forEach((f, i) => {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button";
      if (i === state.fieldIndex) btn.classList.add("active");
      btn.innerHTML =
        '<span class="ico">' + fieldIcon(f) + "</span>" +
        '<span class="txt"><span class="t1"></span><span class="t2"></span></span>';
      btn.querySelector(".t1").textContent = f.label;
      btn.querySelector(".t2").textContent = f.sample ? f.sample.slice(0, 70) : "(empty value)";
      btn.addEventListener("click", () => selectField(i));
      li.appendChild(btn);
      list.appendChild(li);
    });
  }

  function rankedAssessments(field, doc) {
    return field.paths
      .map((p) => WxPath.assessPath(doc.doc, p, field.element))
      .sort((a, b) => b.score - a.score);
  }

  function pickBestDoc() {
    const docs = state.report.docs;
    const idx = docs.findIndex((d) => !d.isHelper);
    return idx >= 0 ? idx : 0;
  }

  function selectField(i) {
    state.fieldIndex = i;
    const field = state.fields[i];
    const doc = state.report.docs[state.docIndex];
    const assessed = rankedAssessments(field, doc);
    state.alts = assessed;

    const best = assessed[0] || { xpath: "", matchCount: 0, sample: "", confidence: "low", risks: ["No path found"] };
    $("keyInput").value = field.key;
    $("urlInput").value = $("urlInput").value || doc.urlHint || "";
    $("pathInput").value = best.xpath;

    paintResult(best, field, doc);
    renderAlts();
    renderFields();
    setSteps();
  }

  function paintResult(res, field, doc) {
    const sampleEl = $("sampleBox");
    const long = res.sample && res.sample.length > 180;
    sampleEl.textContent = res.sample || "(no value found)";
    sampleEl.classList.toggle("is-empty", !res.sample);
    sampleEl.classList.toggle("is-long", !!long);

    const pill = $("matchBox");
    pill.textContent = res.matchCount + (res.matchCount === 1 ? " match" : " matches");
    pill.className = "pill " + (res.matchCount === 1 ? "ok" : res.matchCount === 0 ? "bad" : "warn");

    const conf = $("confPill");
    conf.textContent = res.confidence + " confidence";
    conf.className = "pill " + confClass(res.confidence);

    const risks = res.risks || [];
    $("riskBox").textContent = risks.join(". ");
    $("riskBox").classList.toggle("hidden", risks.length === 0);
    $("whyBox").textContent = field && doc ? explain(field, res, doc) : "";
  }

  function explain(field, best, doc) {
    const bits = [];
    bits.push("“" + field.label + "” on the " + (doc.kindLabel || "page") + ".");
    if (best.matchCount === 1) bits.push("The path finds exactly one element, which is what you want.");
    if (best.matchCount === 0) bits.push("Nothing matched here. Try another page from the same save, or another option below.");
    if (best.matchCount > 1) bits.push("Several elements matched, so the value may not be the one you expect.");
    if (best.sample && best.sample.length > 180) bits.push("The text is very long, which usually means the path grabbed a whole screen instead of one field.");
    if (doc.isIframe) bits.push("This is an inner frame, so the URL filter should be the frame host, not the browser tab.");
    return bits.join(" ");
  }

  function renderAlts() {
    const list = $("altList");
    list.innerHTML = "";
    $("altCount").textContent = String(state.alts.length);
    const current = $("pathInput").value.trim();

    state.alts.forEach((a) => {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button";
      if (a.xpath === current) btn.classList.add("current");
      btn.innerHTML =
        '<span class="alt-top">' +
        '<span class="pill ' + confClass(a.confidence) + '">' + a.score + "</span>" +
        '<span class="pill ' + (a.matchCount === 1 ? "ok" : a.matchCount === 0 ? "bad" : "warn") + '">' + a.matchCount + "</span>" +
        '<span class="pill">' + (a.sample ? a.sample.slice(0, 34) : "empty") + "</span>" +
        "</span>" +
        '<div class="alt-path mono"></div>';
      btn.querySelector(".alt-path").textContent = a.xpath;
      btn.addEventListener("click", () => {
        $("pathInput").value = a.xpath;
        const field = state.fields[state.fieldIndex];
        const doc = state.report.docs[state.docIndex];
        paintResult(a, field, doc);
        renderAlts();
        setSteps();
      });
      li.appendChild(btn);
      list.appendChild(li);
    });
  }

  function clearDetail() {
    state.alts = [];
    state.fieldIndex = -1;
    $("keyInput").value = "";
    $("pathInput").value = "";
    $("altList").innerHTML = "";
    $("altCount").textContent = "0";
    $("sampleBox").textContent = "Select a field to preview the extracted value.";
    $("sampleBox").className = "sample mono is-empty";
    $("matchBox").textContent = "—";
    $("matchBox").className = "pill";
    $("confPill").textContent = "no field selected";
    $("confPill").className = "pill";
    $("riskBox").classList.add("hidden");
    $("whyBox").textContent = "";
  }

  /* ---------------- saved rules ---------------- */

  function renderRules() {
    const list = $("rulesList");
    list.innerHTML = "";
    $("ruleCount").textContent = String(state.accepted.length);
    $("rulesEmpty").classList.toggle("hidden", state.accepted.length > 0);
    $("exportBtn").disabled = state.accepted.length === 0;

    state.accepted.forEach((r, i) => {
      const li = document.createElement("li");
      li.innerHTML =
        '<div class="r-top">' +
        '<span class="r-key mono"></span>' +
        '<span class="pill ' + confClass(r.confidence) + '">' + r.confidence + "</span>" +
        '<button type="button" class="btn sm copy-rule" title="Copy key, XPath and URL">Copy</button>' +
        '<button type="button" class="btn sm ghost rm" title="Remove">&times;</button>' +
        "</div>" +
        '<div class="r-url mono"></div>' +
        '<div class="r-path mono"></div>';
      li.querySelector(".r-key").textContent = r.key;
      li.querySelector(".r-url").textContent = r.url || "(no URL filter)";
      li.querySelector(".r-path").textContent = r.path;
      li.querySelector(".copy-rule").addEventListener("click", () => copyText(ruleText(r), "Rule"));
      li.querySelector(".rm").addEventListener("click", () => {
        state.accepted.splice(i, 1);
        renderRules();
        setSteps();
      });
      list.appendChild(li);
    });
    setSteps();
  }

  function currentRule() {
    const doc = state.report && state.report.docs[state.docIndex];
    const path = $("pathInput").value.trim();
    const assess = doc && path
      ? WxPath.assessPath(doc.doc, path)
      : { matchCount: 0, sample: "", confidence: "low", risks: [] };
    return {
      key: $("keyInput").value.trim() || "field",
      url: $("urlInput").value.trim(),
      path,
      matchCount: assess.matchCount,
      sample: assess.sample,
      confidence: assess.confidence,
      risks: assess.risks
    };
  }

  function acceptRule() {
    const rule = currentRule();
    if (!rule.path) {
      setStatus("Add an XPath before keeping the rule.");
      return;
    }
    if (rule.matchCount === 0 && !confirm("This path matches nothing in the current page. Keep it anyway?")) return;
    if (rule.sample && rule.sample.length > 180 && !confirm("The value looks like a whole page, not one field. Keep it anyway?")) return;

    const dup = state.accepted.findIndex((r) => r.key === rule.key);
    if (dup >= 0) state.accepted[dup] = rule;
    else state.accepted.push(rule);
    renderRules();
    setStatus("Kept " + rule.key + ".");
  }

  /* ---------------- ingest ---------------- */

  async function handleFiles(files, options) {
    const opts = options || {};
    if ((!files || !files.length) && opts.mode !== "folder") return;
    busy(true, opts.mode === "folder" ? "Scanning folder for HTML files…" : "Reading files…");
    $("warnBox").innerHTML = "";

    let fresh;
    try {
      fresh = await WxIngest.ingestFiles(files, opts);
    } catch (err) {
      busy(false, "Could not read this selection.");
      $("warnBox").innerHTML = alertHtml("bad", "The selection could not be read: " + (err.message || String(err)));
      return;
    }
    if (opts.errors && opts.errors.length) fresh.errors.push.apply(fresh.errors, opts.errors);
    if (opts.truncated) {
      fresh.warnings.push("The folder contains more than " + WxFolder.MAX_DIRECTORY_FILES + " files. Only the first files were checked.");
    }

    // Remember where the user was, so adding more pages does not move them.
    const wasOn = state.report && state.report.docs[state.docIndex]
      ? state.report.docs[state.docIndex].name
      : null;

    const report = WxIngest.mergeReports(state.report, fresh);
    state.report = report;
    state.ocr = state.ocr || [];
    if (report.recconfs[0] && report.recconfs[0].raw) state.recconfRaw = report.recconfs[0].raw;

    renderDocs();
    renderRules();

    if (report.docs.length) {
      const stillThere = wasOn ? report.docs.findIndex((d) => d.name === wasOn) : -1;
      selectDoc(stillThere > -1 ? stillThere : pickBestDoc());
      $("drop").classList.add("compact");
    } else {
      state.fields = [];
      renderFields();
      clearDetail();
    }
    setHidden("resetBtn", !report.docs.length && !report.images.length && !report.pdfs.length);

    for (const img of report.pendingImages) {
      try {
        state.ocr.push(await WxOcr.ocrImage(img, (m) => busy(true, m)));
      } catch (err) {
        report.warnings.push("OCR failed for " + img.name + ": " + err.message);
      }
    }
    for (const pdf of report.pendingPdfs) {
      try {
        state.ocr.push(await WxOcr.readPdf(pdf, (m) => busy(true, m)));
      } catch (err) {
        report.warnings.push("PDF read failed for " + pdf.name + ": " + err.message);
      }
    }
    renderOcr();

    const notes = [];
    if (report.errors.length) notes.push(alertHtml("bad", report.errors.join(" ")));
    if (report.warnings.length) notes.push(alertHtml("warn", report.warnings.join(" ")));
    if (report.missingFrames.length) {
      notes.push(alertHtml("warn",
        "These pages embed " + report.missingFrames.length + " sub-page(s) that are not loaded: " +
        escapeHtml(report.missingFrames.slice(0, 3).join(", ")) +
        (report.missingFrames.length > 3 ? ", and more" : "") +
        ". A saved page keeps its iframes as separate files in the <strong>_files</strong> folder, and a lone HTML file cannot reach them. " +
        "Nothing already loaded is lost when you add it." +
        '<button type="button" class="btn sm alert-action" data-action="add-folder">Choose the folder</button>', true));
    }
    if (!report.docs.length && (report.images.length || report.pdfs.length)) {
      notes.push(alertHtml("info", "Only images or PDFs were loaded. Add the saved <strong>HTML</strong> to get XPaths and URL filters.", true));
    }
    const helpers = report.docs.filter((d) => d.isHelper).length;
    if (helpers) {
      notes.push(alertHtml("info", "Chrome saved " + helpers + " helper frame(s) with no fields (login, token, blank). They are hidden. " + report.usefulDocs + " real page(s) found."));
    }
    $("warnBox").innerHTML = notes.join("");

    busy(false, addSummary(report));
    setSteps();
  }

  function addSummary(report) {
    if (!report.docs.length) return "No HTML found.";
    const ignored = report.input.ignoredFiles
      ? ", ignored " + report.input.ignoredFiles + " non-HTML file(s)"
      : "";
    const dupes = report.input.duplicateFiles
      ? ", skipped " + report.input.duplicateFiles + " already loaded"
      : "";
    if (!report.carriedDocs) {
      return "Ready. " + report.docs.length + " page(s) loaded" + ignored + ". Pick a field on the left.";
    }
    if (!report.addedDocs) {
      return "Nothing new" + dupes + ". Still " + report.docs.length + " page(s) loaded.";
    }
    return "Added " + report.addedDocs + " page(s)" + ignored + dupes +
      ". Now " + report.docs.length + " page(s) loaded.";
  }

  /* index.html and the scripts are cached separately, so they can briefly
     disagree after a deploy. Say so rather than half-working. */
  function checkBuild() {
    const stamp = $("buildId");
    const shown = stamp ? stamp.textContent.trim() : "";
    if (shown === BUILD) return;
    $("warnBox").innerHTML = alertHtml("bad",
      "Your browser is showing an older copy of this page" +
      (shown ? " (build " + escapeHtml(shown) + ", the code is build " + BUILD + ")" : "") +
      ". Reload with <strong>Cmd+Shift+R</strong> on Mac or <strong>Ctrl+Shift+R</strong> on Windows, then try again.", true);
  }

  function startOver() {
    state.report = null;
    state.accepted = [];
    state.ocr = [];
    state.fields = [];
    state.docIndex = -1;
    state.fieldIndex = -1;
    state.recconfRaw = "";
    $("urlInput").value = "";
    $("warnBox").innerHTML = "";
    $("drop").classList.remove("compact");
    setHidden("resetBtn", true);
    renderDocs();
    renderRules();
    renderFields();
    renderOcr();
    clearDetail();
    setSteps();
    busy(false, "Cleared. Add pages to start again.");
  }

  function renderOcr() {
    const box = $("ocrBox");
    if (!state.ocr.length) {
      box.textContent = "Drop a screenshot or PDF to suggest field names.";
      return;
    }
    box.textContent = state.ocr
      .map((o) => o.name + "\n" + o.suggestions.map((s) => "  " + s.key + "   ←  " + s.label + (s.valueGuess ? "   (near: " + s.valueGuess + ")" : "")).join("\n"))
      .join("\n\n");
  }

  async function loadDemo() {
    busy(true, "Loading sample pages…");
    try {
      const names = ["fixtures/sharepoint-edit-outer.html", "fixtures/powerapps-iframe.html", "fixtures/sharepoint-list.html", "fixtures/veeva.html"];
      const files = [];
      for (const n of names) {
        const embedded = window.WEA_FIXTURES && window.WEA_FIXTURES[n];
        const text = embedded != null ? embedded : await (await fetch(n)).text();
        files.push(new File([text], n.split("/").pop(), { type: "text/html" }));
      }
      await handleFiles(files);
    } catch (err) {
      busy(false, "Could not load samples: " + err.message);
    }
  }

  /* ---------------- search ---------------- */

  function searchLabel() {
    const q = $("searchInput").value.trim().toLowerCase();
    if (!q) return;
    const idx = state.fields.findIndex(
      (f) => f.label.toLowerCase().includes(q) || f.key.includes(q) || (f.sample || "").toLowerCase().includes(q)
    );
    if (idx >= 0) {
      selectField(idx);
      setStatus("Jumped to “" + state.fields[idx].label + "”.");
    } else {
      setStatus("No field matches “" + q + "” on this page.");
    }
  }

  /* ---------------- wiring ---------------- */

  function bindDrop() {
    const drop = $("drop");
    ["dragenter", "dragover"].forEach((ev) =>
      drop.addEventListener(ev, (e) => {
        e.preventDefault();
        drop.classList.add("is-over");
      })
    );
    ["dragleave", "drop"].forEach((ev) =>
      drop.addEventListener(ev, (e) => {
        e.preventDefault();
        drop.classList.remove("is-over");
      })
    );
    drop.addEventListener("drop", async (e) => {
      busy(true, "Reading dropped files and folders…");
      const found = await WxFolder.collectDroppedFiles(e.dataTransfer);
      if (!found.files.length) {
        if (found.hadDirectory) {
          await handleFiles([], {
            mode: "folder",
            errors: found.errors,
            truncated: found.truncated,
            ignoredFiles: found.ignoredFiles
          });
        } else {
          busy(false, "Nothing readable was dropped.");
          $("warnBox").innerHTML = alertHtml("bad", "No readable files were found. Drop a folder containing HTML files, or pick one from the Add pages button.");
        }
        return;
      }
      await handleFiles(found.files, {
        mode: found.hadDirectory ? "folder" : "files",
        errors: found.errors,
        truncated: found.truncated,
        ignoredFiles: found.ignoredFiles
      });
    });
    $("fileInput").addEventListener("change", async (e) => {
      const pairing = state.pairing;
      state.pairing = false;
      await handleFiles(e.target.files, { mode: "files" });
      e.target.value = "";
      // The second dialog cannot be opened for the user: reading the file spends
      // the click that would have authorised it. Point at the button instead.
      if (!pairing) return;
      const next = $("warnBox").querySelector("[data-action='add-folder']");
      if (next) {
        next.scrollIntoView({ block: "nearest" });
        next.focus();
        setStatus("Now choose the _files folder for that page.");
      }
    });
    $("folderInput").addEventListener("change", async (e) => {
      await handleFiles(e.target.files, { mode: "folder" });
      e.target.value = "";
    });
  }

  /* A single file input cannot offer both files and folders, so one button opens
     a chooser that routes to the right hidden input. */
  function bindAddMenu() {
    const btn = $("addBtn");
    const menu = $("addMenu");
    if (!btn || !menu) return;
    const items = Array.from(menu.querySelectorAll(".add-menu-item"));

    function setOpen(open, moveFocus) {
      const wasOpen = !menu.classList.contains("hidden");
      menu.classList.toggle("hidden", !open);
      btn.setAttribute("aria-expanded", open ? "true" : "false");
      if (!moveFocus) return;
      if (open) items[0].focus();
      else if (wasOpen) btn.focus();
    }
    const isOpen = () => !menu.classList.contains("hidden");

    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      setOpen(!isOpen(), false);
    });
    btn.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        setOpen(true, true);
      }
    });

    on("pickFolderBtn", "click", () => {
      setOpen(false);
      $("folderInput").click();
    });
    on("pickFilesBtn", "click", () => {
      setOpen(false);
      $("fileInput").click();
    });
    on("pickPairBtn", "click", () => {
      setOpen(false);
      state.pairing = true;
      $("fileInput").click();
    });

    menu.addEventListener("keydown", (e) => {
      const at = items.indexOf(document.activeElement);
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false, true);
      } else if (e.key === "ArrowDown" && at > -1) {
        e.preventDefault();
        items[(at + 1) % items.length].focus();
      } else if (e.key === "ArrowUp" && at > -1) {
        e.preventDefault();
        items[(at - 1 + items.length) % items.length].focus();
      }
    });

    document.addEventListener("click", (e) => {
      if (isOpen() && !menu.contains(e.target) && e.target !== btn) setOpen(false);
    });
  }

  function init() {
    checkBuild();
    bindDrop();
    bindAddMenu();
    // Alerts are rebuilt as HTML, so their buttons are handled by delegation.
    $("warnBox").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-action='add-folder']");
      if (btn) $("folderInput").click();
    });
    $("demoBtn").addEventListener("click", loadDemo);
    on("resetBtn", "click", startOver);
    $("hideEmpty").addEventListener("change", renderDocs);
    $("acceptBtn").addEventListener("click", acceptRule);
    $("searchBtn").addEventListener("click", searchLabel);
    $("searchInput").addEventListener("keydown", (e) => {
      if (e.key === "Enter") searchLabel();
    });

    $("recheckBtn").addEventListener("click", () => {
      if (!state.report) return;
      const r = currentRule();
      paintResult(r, state.fields[state.fieldIndex], state.report.docs[state.docIndex]);
      renderAlts();
      setSteps();
    });

    $("copyKeyBtn").addEventListener("click", () => copyText($("keyInput").value.trim(), "Key"));
    $("copyUrlBtn").addEventListener("click", () => copyText($("urlInput").value.trim(), "URL"));
    $("copyPathBtn").addEventListener("click", () => copyText($("pathInput").value.trim(), "XPath"));
    $("copyRuleBtn").addEventListener("click", () => copyText(ruleText(currentRule()), "Rule"));

    $("exportBtn").addEventListener("click", () => {
      WxExport.download("webpage-extractions.xml", WxExport.blockXml(state.accepted), "application/xml");
      WxExport.download("webpage-extractions.csv", WxExport.csv(state.accepted), "text/csv");
      if (state.recconfRaw) {
        WxExport.download("updated.recconf", WxExport.mergeRecconf(state.recconfRaw, state.accepted), "application/xml");
      }
      setStatus("Downloaded " + state.accepted.length + " rule(s).");
    });

    $("copyBtn").addEventListener("click", () => copyText(WxExport.blockXml(state.accepted), "XML"));

    $("clearBtn").addEventListener("click", () => {
      state.accepted = [];
      renderRules();
    });

    $("testBtn").addEventListener("click", () => WxSelfTest.run($("testList")));

    renderRules();
    clearDetail();
    setSteps();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
