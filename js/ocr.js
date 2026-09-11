(function (global) {
  let workerPromise = null;

  function singleFileNotice() {
    return "This one-file copy does not include OCR/PDF engines (they need extra worker files). Use HTML, ZIP, or a folder here. For screenshots/PDFs, open the full folder app with ./serve.sh.";
  }

  function localTesseractOptions() {
    if (window.WEA_SINGLE_FILE) throw new Error(singleFileNotice());
    const root = new URL("./vendor/tesseract/", window.location.href);
    return {
      workerPath: new URL("worker.min.js", root).href,
      corePath: new URL("core/", root).href,
      langPath: new URL("lang", root).href.replace(/\/$/, ""),
      gzip: true,
      logger: function () {}
    };
  }

  async function getWorker(onStatus) {
    if (workerPromise) return workerPromise;
    workerPromise = (async function () {
      if (typeof Tesseract === "undefined") throw new Error("Tesseract failed to load");
      onStatus && onStatus("Starting local OCR engine…");
      const worker = await Tesseract.createWorker("eng", 1, localTesseractOptions());
      return worker;
    })();
    return workerPromise;
  }

  function wordsToLines(words) {
    const lines = [];
    (words || []).forEach((w) => {
      const t = (w.text || "").trim();
      if (!t) return;
      lines.push({ text: t, conf: w.confidence || 0, bbox: w.bbox });
    });
    return lines;
  }

  function suggestKeys(lines) {
    const labels = [];
    const skip = /^(ok|cancel|save|search|browse|items|list|share|follow)$/i;
    lines.forEach((line, i) => {
      const t = line.text.replace(/[:*]\s*$/, "").trim();
      if (t.length < 2 || t.length > 48 || skip.test(t)) return;
      if (!/[A-Za-z]/.test(t)) return;
      const next = lines[i + 1] ? lines[i + 1].text : "";
      labels.push({
        label: t,
        key: WxPath.slugKey(t),
        valueGuess: next && next.length < 80 ? next : "",
        confidence: line.conf > 70 ? "medium" : "low",
        note: "From screenshot OCR only. Add the matching HTML to get an XPath and URL."
      });
    });
    const uniq = [];
    const seen = new Set();
    labels.forEach((l) => {
      if (seen.has(l.key)) return;
      seen.add(l.key);
      uniq.push(l);
    });
    return uniq.slice(0, 40);
  }

  async function ocrImage(file, onStatus) {
    const worker = await getWorker(onStatus);
    onStatus && onStatus("Reading " + file.name + "…");
    const result = await worker.recognize(file);
    const lines = wordsToLines(result.data.words);
    return {
      name: file.name,
      text: (result.data.text || "").trim(),
      suggestions: suggestKeys(lines),
      warning: "A screenshot has no DOM. OCR can suggest field names. It cannot produce a trustworthy XPath or URL."
    };
  }

  async function readPdf(file, onStatus) {
    if (window.WEA_SINGLE_FILE) throw new Error(singleFileNotice());
    onStatus && onStatus("Opening PDF " + file.name + "…");
    const pdfjs = await import(new URL("./vendor/pdfjs/pdf.min.mjs", window.location.href).href);
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("./vendor/pdfjs/pdf.worker.min.mjs", window.location.href).href;
    const buf = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data: buf }).promise;
    let text = "";
    const max = Math.min(pdf.numPages, 6);
    for (let i = 1; i <= max; i += 1) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      text += content.items.map((it) => it.str).join(" ") + "\n";
    }
    const lines = text.split(/\n+/).flatMap((row) => row.split(/\s{2,}/)).map((t) => ({ text: t.trim(), conf: 90 }));
    return {
      name: file.name,
      text: text.trim(),
      suggestions: suggestKeys(lines.filter((l) => l.text)),
      warning: "PDF text is not a live webpage. Use it to name fields, then add HTML for XPath and URL."
    };
  }

  global.WxOcr = { ocrImage, readPdf };
})(window);
