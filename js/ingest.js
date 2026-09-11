(function (global) {
  const MAX_BYTES = 45 * 1024 * 1024;
  const MAX_INPUT_FILES = 5000;
  const MAX_TOTAL_BYTES = 500 * 1024 * 1024;

  function extOf(name) {
    const n = String(name || "").toLowerCase();
    const i = n.lastIndexOf(".");
    return i >= 0 ? n.slice(i) : "";
  }

  function fileName(file) {
    return String(file && (file._relativePath || file.webkitRelativePath || file.name) || "")
      .replace(/\\/g, "/")
      .replace(/^\/+/, "");
  }

  function isHtmlKind(name, mime) {
    return kindOf(name, mime) === "html";
  }

  function kindOf(name, mime) {
    const ext = extOf(name);
    const m = String(mime || "").toLowerCase();
    if (ext === ".zip" || m.includes("zip")) return "zip";
    if (ext === ".recconf" || ext === ".xml") return "recconf";
    if (ext === ".mht" || ext === ".mhtml") return "mhtml";
    if (ext === ".pdf" || m.includes("pdf")) return "pdf";
    if ([".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif"].includes(ext) || m.startsWith("image/")) return "image";
    if ([".html", ".htm", ".xhtml"].includes(ext) || m.includes("html")) return "html";
    if ([".txt", ".csv", ".json"].includes(ext)) return "text";
    return "other";
  }

  function savedFromUrl(html) {
    const m = String(html).match(/saved from url=\(\d+\)(\S+)/i);
    if (m) return m[1].replace(/-+$/, "");
    const base = String(html).match(/<base[^>]+href=["']([^"']+)["']/i);
    if (base) return base[1];
    return "";
  }

  function stripScripts(html) {
    return String(html)
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/\son[a-z]+="[^"]*"/gi, "")
      .replace(/\son[a-z]+='[^']*'/gi, "");
  }

  function parseHtmlDocument(html, name) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(stripScripts(html), "text/html");
    const iframes = Array.from(doc.querySelectorAll("iframe")).map((f) => ({
      src: f.getAttribute("src") || "",
      title: f.getAttribute("title") || "",
      id: f.getAttribute("id") || ""
    }));
    return {
      name,
      html: stripScripts(html),
      doc,
      title: (doc.querySelector("title") && doc.querySelector("title").textContent || name).trim(),
      sourceUrl: savedFromUrl(html),
      iframes,
      isIframe: /V1\.html$/i.test(name) || /saved_resource/i.test(name) || /iframe/i.test(name)
    };
  }

  function parseMhtml(text, name) {
    const parts = String(text).split(/------=_NextPart_\S+/);
    const htmlPart = parts.find((p) => /Content-Type:\s*text\/html/i.test(p)) || text;
    const body = htmlPart.replace(/^[\s\S]*?\r?\n\r?\n/, "");
    const decoded = body.includes("quoted-printable") || /=\r?\n/.test(body)
      ? body.replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
      : body;
    return parseHtmlDocument(decoded, name);
  }

  async function readZip(file) {
    const zip = await JSZip.loadAsync(file);
    const docs = [];
    const others = [];
    const names = Object.keys(zip.files);
    for (const path of names) {
      const entry = zip.files[path];
      if (entry.dir) continue;
      const kind = kindOf(path);
      if (kind === "html") {
        const html = await entry.async("string");
        docs.push(parseHtmlDocument(html, path));
      } else if (kind === "image" || kind === "pdf" || kind === "recconf" || kind === "mhtml") {
        others.push({ name: path, kind, blob: await entry.async("blob") });
      }
    }
    docs.sort((a, b) => Number(a.isIframe) - Number(b.isIframe));
    return { docs, others, zipNames: names };
  }

  async function readRecconf(text) {
    const parser = new DOMParser();
    const xml = parser.parseFromString(text, "text/xml");
    const nodes = Array.from(xml.querySelectorAll("WebPageDataExtraction"));
    return nodes.map((n) => ({
      key: (n.querySelector("Key") && n.querySelector("Key").textContent) || "",
      path: (n.querySelector("Path") && n.querySelector("Path").textContent) || "",
      url: (n.querySelector("Url") && n.querySelector("Url").textContent) || ""
    }));
  }

  async function ingestFiles(fileList, options) {
    const opts = options || {};
    const folderMode = opts.mode === "folder";
    const files = Array.from(fileList || []);
    const report = {
      docs: [],
      images: [],
      pdfs: [],
      recconfs: [],
      warnings: [],
      errors: [],
      input: {
        mode: folderMode ? "folder" : "files",
        totalFiles: files.length + Number(opts.ignoredFiles || 0),
        htmlFiles: 0,
        ignoredFiles: Number(opts.ignoredFiles || 0),
        duplicateFiles: 0,
        oversizedFiles: 0,
        processedFiles: 0
      }
    };

    if (!files.length) {
      if (folderMode && report.input.ignoredFiles) {
        report.errors.push("This folder does not contain any HTML files. Choose a folder containing .html, .htm, or .xhtml files.");
        report.warnings.push(report.input.ignoredFiles + " non-HTML file(s) in the folder were ignored.");
      } else if (folderMode) {
        report.errors.push("The selected folder is empty or could not be read. Choose a folder that contains HTML files.");
      }
      return report;
    }

    const candidates = folderMode
      ? files.filter((file) => isHtmlKind(fileName(file), file.type))
      : files;
    if (folderMode) report.input.ignoredFiles += files.length - candidates.length;

    if (candidates.length > MAX_INPUT_FILES) {
      report.errors.push("This selection contains more than " + MAX_INPUT_FILES + " processable files. Only the first " + MAX_INPUT_FILES + " files were checked.");
    }

    const selected = candidates.slice(0, MAX_INPUT_FILES);
    let totalBytes = 0;
    const seen = new Set();

    for (const file of selected) {
      const name = fileName(file);
      const identity = name.toLowerCase();
      if (seen.has(identity)) {
        report.input.duplicateFiles += 1;
        continue;
      }
      seen.add(identity);

      const kind = kindOf(name, file.type);
      if (kind === "html") report.input.htmlFiles += 1;

      if (file.size > MAX_BYTES) {
        report.input.oversizedFiles += 1;
        report.errors.push(name + " is larger than 45 MB and was skipped.");
        continue;
      }
      totalBytes += Number(file.size || 0);
      if (totalBytes > MAX_TOTAL_BYTES) {
        report.errors.push("The selected files exceed the 500 MB safety limit. Remaining files were skipped.");
        break;
      }

      try {
        if (kind === "zip") {
          const z = await readZip(file);
          report.docs.push.apply(report.docs, z.docs.map((d) => Object.assign(d, { archive: name })));
          for (const o of z.others) {
            const f = new File([o.blob], o.name, { type: o.blob.type });
            if (o.kind === "image") report.images.push(f);
            else if (o.kind === "pdf") report.pdfs.push(f);
            else if (o.kind === "recconf") report.recconfs.push({ name: o.name, rules: await readRecconf(await o.blob.text()) });
          }
          if (!z.docs.length) report.warnings.push(name + " had no HTML files.");
        } else if (kind === "html") {
          report.docs.push(parseHtmlDocument(await file.text(), name));
        } else if (kind === "mhtml") {
          report.docs.push(parseMhtml(await file.text(), name));
        } else if (kind === "image") {
          report.images.push(file);
        } else if (kind === "pdf") {
          report.pdfs.push(file);
        } else if (kind === "recconf") {
          const text = await file.text();
          report.recconfs.push({ name, rules: await readRecconf(text), raw: text });
        } else {
          report.warnings.push(name + " is not a supported type. Use HTML, ZIP, image, PDF, or recconf.");
        }
        report.input.processedFiles += 1;
      } catch (err) {
        report.errors.push(name + ": " + (err && err.message ? err.message : String(err)));
      }
    }

    if (folderMode) {
      if (!report.input.htmlFiles) {
        report.errors.push("This folder does not contain any HTML files. Choose a folder containing .html, .htm, or .xhtml files.");
      } else if (!report.docs.length) {
        report.errors.push("HTML files were found, but none could be processed. Check the file size and read errors above.");
      }
      if (report.input.ignoredFiles) {
        report.warnings.push(report.input.ignoredFiles + " non-HTML file(s) in the folder were ignored.");
      }
      if (report.input.duplicateFiles) {
        report.warnings.push(report.input.duplicateFiles + " duplicate file path(s) were ignored.");
      }
    }
    const HELPER = /(TokenFactoryIframe|authorize|checksession|blank|silent|signin|logout|pixel|beacon|ads?)[^/]*\.html?$/i;

    report.docs.forEach((d) => {
      d.kindLabel = d.isIframe ? "iframe / inner page" : "outer page";
      d.urlHint = WxPath.inferUrl(d.sourceUrl, d.isIframe ? "iframe" : "page");
      if (/powerplatform|powerapps/i.test(d.sourceUrl) || /V1\.html$/i.test(d.name)) {
        d.urlHint = d.urlHint || "runtime-app.powerplatform.com";
        d.kindLabel = "Power Apps iframe";
      }
      d.richness = WxPath.documentRichness(d.doc);
      d.isHelper = HELPER.test(d.name) || d.richness === 0;
      if (d.isHelper) d.kindLabel = "helper frame, no fields";
    });

    report.docs.sort((a, b) => b.richness - a.richness);
    report.usefulDocs = report.docs.filter((d) => !d.isHelper).length;
    return report;
  }

  global.WxIngest = {
    kindOf,
    ingestFiles,
    parseHtmlDocument,
    readRecconf,
    fileName,
    isHtmlKind,
    MAX_BYTES,
    MAX_INPUT_FILES,
    MAX_TOTAL_BYTES
  };
})(window);
