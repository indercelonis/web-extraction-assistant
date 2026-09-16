#!/usr/bin/env node
// Push the given files to the GitHub Pages repo as a single commit.
// The Contents API would make one commit per file, so use the Git Data API.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = "indercelonis/web-extraction-assistant";
const BRANCH = "main";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const paths = process.argv.slice(2);
if (!paths.length) {
  console.error("usage: MSG='...' node js/push-pages.mjs <path> [path...]");
  process.exit(2);
}

const gh = (args, body) =>
  JSON.parse(execFileSync("gh", ["api", ...args], {
    input: body ? JSON.stringify(body) : undefined,
    encoding: "utf8"
  }));

const base = gh([`repos/${REPO}/git/ref/heads/${BRANCH}`]).object.sha;
const baseTree = gh([`repos/${REPO}/git/commits/${base}`]).tree.sha;

const tree = paths.map((path) => {
  const sha = gh([`repos/${REPO}/git/blobs`, "--input", "-"], {
    encoding: "base64",
    content: readFileSync(resolve(ROOT, path)).toString("base64")
  }).sha;
  console.log("  staged " + path);
  return { path, mode: "100644", type: "blob", sha };
});

const newTree = gh([`repos/${REPO}/git/trees`, "--input", "-"], { base_tree: baseTree, tree }).sha;
const commit = gh([`repos/${REPO}/git/commits`, "--input", "-"], {
  message: process.env.MSG || "Update site",
  tree: newTree,
  parents: [base]
}).sha;
gh([`repos/${REPO}/git/refs/heads/${BRANCH}`, "-X", "PATCH", "--input", "-"], { sha: commit });
console.log("pushed " + commit.slice(0, 7));
