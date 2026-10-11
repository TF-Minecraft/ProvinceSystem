import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { JSDOM } from "jsdom";

const PRIVATE_SELECTORS = [
  "script",
  "style",
  "nav",
  "footer",
  "[data-wiki-search-exclude]",
  '[data-variant="bug"]',
  '[data-variant="draft"]',
  '[data-variant="staff"]',
];

function cleanText(node) {
  if (!node) return "";
  const blockTags = new Set([
    "ARTICLE",
    "ASIDE",
    "BLOCKQUOTE",
    "BR",
    "CAPTION",
    "DD",
    "DIV",
    "DL",
    "DT",
    "FIGCAPTION",
    "FIGURE",
    "H1",
    "H2",
    "H3",
    "H4",
    "H5",
    "H6",
    "HEADER",
    "LI",
    "BUTTON",
    "LABEL",
    "MAIN",
    "OL",
    "OPTION",
    "P",
    "SECTION",
    "SELECT",
    "TABLE",
    "TBODY",
    "TD",
    "TFOOT",
    "TH",
    "THEAD",
    "TR",
    "UL",
  ]);
  const parts = [];
  const visit = (current) => {
    if (current.nodeType === 3) {
      parts.push(current.nodeValue ?? "");
      return;
    }
    if (current.nodeType === 1 && current.tagName === "IMG") {
      const alt = current.getAttribute("alt")?.trim();
      const visibleSiblingText = Array.from(current.parentElement?.childNodes ?? [])
        .filter((sibling) => sibling !== current)
        .map((sibling) => sibling.textContent ?? "")
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (alt && !visibleSiblingText.toLocaleLowerCase().includes(alt.toLocaleLowerCase())) {
        parts.push(` ${alt} `);
      }
      return;
    }
    const isBlock = current.nodeType === 1 && blockTags.has(current.tagName);
    if (isBlock) parts.push(" ");
    for (const child of current.childNodes) visit(child);
    if (isBlock) parts.push(" ");
  };
  visit(node);
  return parts.join("").replace(/\s+/g, " ").trim();
}

export function routeFromHtmlPath(filePath, wikiRoot) {
  if (path.resolve(filePath) === path.resolve(`${wikiRoot}.html`)) return "/wiki";
  const relative = path
    .relative(wikiRoot, filePath)
    .replaceAll(path.sep, "/")
    .replace(/\.html$/, "");
  const route = relative === "index" || relative === "wiki" ? "" : relative.replace(/\/index$/, "");
  return `/wiki${route ? `/${route}` : ""}`;
}

export function extractSearchEntries(html, href) {
  const document = new JSDOM(html).window.document;
  const source = document.querySelector("main article");
  if (!source) return [];

  const article = source.cloneNode(true);
  article.querySelectorAll(PRIVATE_SELECTORS.join(",")).forEach((node) => node.remove());
  const heading = article.querySelector("h1");
  const pageTitle = cleanText(heading);
  if (!pageTitle) return [];
  heading.remove();

  const entries = [];
  let sectionTitle;
  let sectionHref = href;
  let parts = [];
  const commit = () => {
    const text = parts.join(" ").replace(/\s+/g, " ").trim();
    if (text) entries.push({ href: sectionHref, pageTitle, ...(sectionTitle ? { sectionTitle } : {}), text });
    parts = [];
  };

  for (const node of article.children) {
    if (node.matches("h2")) {
      commit();
      const headingText = cleanText(node);
      if (node.id) {
        sectionTitle = headingText;
        sectionHref = `${href}#${encodeURIComponent(node.id)}`;
      } else {
        // A section without a real anchor cannot be a separate destination. Fold its
        // heading and body into the page entry so every indexed href stays unique.
        sectionTitle = undefined;
        sectionHref = href;
        if (headingText) parts.push(headingText);
      }
    } else {
      const text = cleanText(node);
      if (text) parts.push(text);
    }
  }
  commit();

  if (!entries.length) entries.push({ href, pageTitle, text: pageTitle });
  const uniqueEntries = new Map();
  for (const entry of entries) {
    const existing = uniqueEntries.get(entry.href);
    if (existing) existing.text = `${existing.text} ${entry.text}`.replace(/\s+/g, " ").trim();
    else uniqueEntries.set(entry.href, entry);
  }
  return Array.from(uniqueEntries.values());
}

async function findHtmlFiles(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...(await findHtmlFiles(fullPath)));
    else if (entry.isFile() && entry.name.endsWith(".html")) output.push(fullPath);
  }
  return output;
}

export async function buildWikiSearchIndex({ wikiRoot, outputFile }) {
  const files = (await findHtmlFiles(wikiRoot)).sort();
  try {
    await readFile(`${wikiRoot}.html`, "utf8");
    files.unshift(`${wikiRoot}.html`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const entries = [];
  for (const filePath of files) {
    const href = routeFromHtmlPath(filePath, wikiRoot);
    const html = await readFile(filePath, "utf8");
    entries.push(...extractSearchEntries(html, href));
  }
  entries.sort((a, b) => a.href.localeCompare(b.href));
  await mkdir(path.dirname(outputFile), { recursive: true });
  await writeFile(outputFile, `${JSON.stringify(entries)}\n`, "utf8");
  return entries;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const wikiRoot = path.join(frontendRoot, ".next", "server", "app", "wiki");
  const outputFile = path.join(frontendRoot, "public", "wiki", "search-index.json");
  const entries = await buildWikiSearchIndex({ wikiRoot, outputFile });
  console.log(`Generated ${entries.length} guide search entries.`);
}
