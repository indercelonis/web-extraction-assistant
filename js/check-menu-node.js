#!/usr/bin/env node
// Boots the real page in jsdom and drives the Add pages menu the way a user would.
const assert = require("assert");
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");

const root = path.resolve(__dirname, "..");
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => {
  if (!/Could not parse CSS|Could not load/.test(e.message)) throw e;
});

JSDOM.fromFile(path.join(root, "index.html"), {
  resources: "usable",
  runScripts: "dangerously",
  virtualConsole: vc
}).then((dom) => {
  const { window } = dom;
  window.addEventListener("load", () => {
   try {
    const doc = window.document;
    const btn = doc.getElementById("addBtn");
    const menu = doc.getElementById("addMenu");
    const folderInput = doc.getElementById("folderInput");
    const fileInput = doc.getElementById("fileInput");

    const click = (el) => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    const key = (el, k) => el.dispatchEvent(new window.KeyboardEvent("keydown", { key: k, bubbles: true }));

    assert.ok(menu.classList.contains("hidden"), "Menu starts closed");

    click(btn);
    assert.ok(!menu.classList.contains("hidden"), "Button opens the menu");
    assert.strictEqual(btn.getAttribute("aria-expanded"), "true", "aria-expanded tracks the open state");

    click(btn);
    assert.ok(menu.classList.contains("hidden"), "Button closes the menu again");

    // Folder route reaches the directory input.
    let opened = null;
    folderInput.click = () => { opened = "folder"; };
    fileInput.click = () => { opened = "files"; };

    click(btn);
    click(doc.getElementById("pickFolderBtn"));
    assert.strictEqual(opened, "folder", "Folder item opens the directory picker");
    assert.ok(menu.classList.contains("hidden"), "Choosing an item closes the menu");

    click(btn);
    click(doc.getElementById("pickFilesBtn"));
    assert.strictEqual(opened, "files", "File item opens the file picker");

    // Escape closes and returns focus.
    click(btn);
    key(menu, "Escape");
    assert.ok(menu.classList.contains("hidden"), "Escape closes the menu");
    assert.strictEqual(doc.activeElement, btn, "Escape returns focus to the button");

    // Clicking elsewhere closes without hijacking focus.
    click(btn);
    click(doc.body);
    assert.ok(menu.classList.contains("hidden"), "Outside click closes the menu");

    // Keyboard opening lands on the first item.
    key(btn, "ArrowDown");
    assert.ok(!menu.classList.contains("hidden"), "ArrowDown opens the menu");
    assert.strictEqual(doc.activeElement.id, "pickFolderBtn", "ArrowDown focuses the first item");
    key(menu, "ArrowDown");
    assert.strictEqual(doc.activeElement.id, "pickFilesBtn", "ArrowDown moves to the next item");
    key(menu, "ArrowUp");
    assert.strictEqual(doc.activeElement.id, "pickFolderBtn", "ArrowUp moves back");

    console.log("Add menu checks passed");
   } catch (err) {
    console.error(err.message || err);
    process.exit(1);
   }
  });
}).catch((e) => {
  console.error(e);
  process.exit(1);
});
