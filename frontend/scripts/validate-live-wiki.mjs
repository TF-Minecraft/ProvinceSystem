import { readFile, writeFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { extractSearchEntries } from "./build-wiki-search-index.mjs";

const base = "http://127.0.0.1:3000";
const refreshRouteIndex = process.argv.indexOf("--refresh-route");
if (refreshRouteIndex >= 0) {
  const route = process.argv[refreshRouteIndex + 1];
  if (!route?.startsWith("/wiki")) throw new Error("--refresh-route requires a /wiki route");
  const response = await fetch(`${base}${route}`);
  if (response.status !== 200) throw new Error(`${route} returned HTTP ${response.status}`);
  const fresh = extractSearchEntries(await response.text(), route);
  const checkedIn = JSON.parse(await readFile("public/wiki/search-index.json", "utf8"));
  const merged = checkedIn
    .filter((entry) => entry.href !== route && !entry.href.startsWith(`${route}#`))
    .concat(fresh)
    .sort((a, b) => a.href.localeCompare(b.href));
  await writeFile("public/wiki/search-index.json", `${JSON.stringify(merged)}\n`, "utf8");
  console.log(`Refreshed ${fresh.length} entries for ${route}; index contains ${merged.length} entries.`);
  process.exit(0);
}
const manifest = JSON.parse(await readFile(".next/prerender-manifest.json", "utf8"));
const routes = Object.keys(manifest.routes)
  .filter((route) => route === "/wiki" || route.startsWith("/wiki/"))
  .sort();
const routeSet = new Set(routes);
const failures = [];
const freshEntries = [];
const forbidden = [
  ["literal em dash", /—/u],
  ["em dash entity", /&(?:mdash|#8212|#x2014);/iu],
  ["Last verified", /Last verified/i],
  ["draft label", /Draft:\s*unverified/i],
  ["known bug wording", /known[- ]bug/i],
  ["staff wording", /staff[- ]only|\bstaff command/i],
  ["permission node wording", /permission node/i],
  ["unverified wording", /\bunverified\b/i],
  ["mojibake", /â€|Ã.|Â.|�/u],
];

for (const route of routes) {
  const response = await fetch(`${base}${route}`);
  if (response.status !== 200) {
    failures.push(`${route}: HTTP ${response.status}`);
    continue;
  }
  const html = await response.text();
  const document = new JSDOM(html).window.document;
  const article = document.querySelector("main article") ?? document.querySelector("main");
  if (!article) failures.push(`${route}: missing main content`);
  const visible = article?.textContent ?? "";
  for (const [label, pattern] of forbidden) {
    if (pattern.test(visible)) failures.push(`${route}: ${label}`);
  }
  freshEntries.push(...extractSearchEntries(html, route));
  for (const anchor of article?.querySelectorAll("a[href]") ?? []) {
    const href = anchor.getAttribute("href");
    if (!href?.startsWith("/wiki")) continue;
    const url = new URL(href, base);
    if (
      url.pathname.startsWith("/wiki/models/") ||
      url.pathname.startsWith("/wiki/textures/") ||
      url.pathname.startsWith("/wiki/sounds/")
    )
      continue;
    if (!routeSet.has(url.pathname.replace(/\/$/, ""))) failures.push(`${route}: missing target ${href}`);
    if (url.hash) {
      const targetResponse = url.pathname === route ? response : await fetch(`${base}${url.pathname}`);
      const targetHtml = url.pathname === route ? html : await targetResponse.text();
      const targetDocument = new JSDOM(targetHtml).window.document;
      if (!targetDocument.getElementById(decodeURIComponent(url.hash.slice(1))))
        failures.push(`${route}: missing anchor ${href}`);
    }
  }
}

for (const route of ["/wiki/essentials", "/wiki/help-menu", "/wiki/crates", "/wiki/trial-rooms"]) {
  const response = await fetch(`${base}${route}`);
  if (response.status !== 404) failures.push(`${route}: retired route returned ${response.status}`);
}

freshEntries.sort((a, b) => a.href.localeCompare(b.href));
const checkedIn = JSON.parse(await readFile("public/wiki/search-index.json", "utf8"));
const freshJson = JSON.stringify(freshEntries);
const checkedJson = JSON.stringify(checkedIn);
const stale = freshJson !== checkedJson;
const checkedByHref = new Map(checkedIn.map((entry) => [entry.href, entry]));
const freshByHref = new Map(freshEntries.map((entry) => [entry.href, entry]));
const changedHrefs = [...new Set([...checkedByHref.keys(), ...freshByHref.keys()])]
  .filter((href) => JSON.stringify(checkedByHref.get(href)) !== JSON.stringify(freshByHref.get(href)))
  .sort();

console.log(`Routes: ${routes.length}`);
console.log(`Fresh entries: ${freshEntries.length}`);
console.log(`Checked-in entries: ${checkedIn.length}`);
console.log(`Search index stale: ${stale}`);
console.log(`Changed hrefs: ${changedHrefs.length}${changedHrefs.length ? ` (${changedHrefs.join(", ")})` : ""}`);
console.log(`Failures: ${failures.length}`);
for (const failure of failures) console.log(`- ${failure}`);
if (process.argv.includes("--write-index") && !failures.length) {
  await writeFile("public/wiki/search-index.json", `${freshJson}\n`, "utf8");
  console.log("Wrote current live extraction to public/wiki/search-index.json.");
}
process.exitCode = failures.length ? 1 : 0;
