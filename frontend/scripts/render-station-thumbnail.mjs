/**
 * Render a station's 256x256 transparent thumbnail from the live 3D viewer.
 *
 * Needs the dev server running and a local Chrome/Edge. Drives the browser headlessly over
 * the DevTools protocol, so there is no extra dependency.
 *
 * Usage:
 *   node scripts/render-station-thumbnail.mjs <station-slug> [base-url]
 *   node scripts/render-station-thumbnail.mjs --furniture <piece-id> [base-url]
 *
 * The furniture form captures /wiki/furniture?piece=<id> into thumbnails/furniture/<id>.webp.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const furniture = process.argv[2] === "--furniture";
const args = process.argv.slice(furniture ? 3 : 2);
const slug = args[0];
const baseUrl = args[1] ?? "http://localhost:3000";
if (!slug) {
  console.error("usage: node scripts/render-station-thumbnail.mjs <station-slug> [base-url]");
  process.exit(1);
}

const browser = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].find((candidate) => candidate && existsSync(candidate));
if (!browser) throw new Error("No Chrome/Edge found; set CHROME_PATH.");

const port = 9333;
const pageUrl = furniture ? `${baseUrl}/wiki/furniture?piece=${slug}` : `${baseUrl}/wiki/stations/${slug}`;
const output = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "public",
  "wiki",
  "thumbnails",
  furniture ? "furniture" : "stations",
  `${slug}.webp`,
);
const child = spawn(
  browser,
  [
    "--headless=new",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${mkdtempSync(path.join(tmpdir(), "thumb-"))}`,
    "--enable-unsafe-swiftshader",
    "--use-angle=swiftshader",
    "--window-size=1280,900",
    "about:blank",
  ],
  { stdio: "ignore" },
);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The station page's full-size viewer is the first canvas; copy its centre square to 256px.
const capture = `new Promise((resolve) => requestAnimationFrame(() => {
  const canvas = document.querySelector("canvas");
  if (!canvas) return resolve(null);
  const side = Math.min(canvas.width, canvas.height);
  const out = document.createElement("canvas");
  out.width = out.height = 256;
  out.getContext("2d").drawImage(canvas, (canvas.width - side) / 2, (canvas.height - side) / 2, side, side, 0, 0, 256, 256);
  resolve(out.toDataURL("image/webp", 0.9));
}))`;

try {
  let target;
  for (let attempt = 0; attempt < 50 && !target; attempt += 1) {
    await sleep(200);
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      target = targets.find((entry) => entry.type === "page");
    } catch {
      /* browser still starting */
    }
  }
  if (!target) throw new Error("Browser did not expose a DevTools page.");

  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  let nextId = 0;
  const pending = new Map();
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  };
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id = (nextId += 1);
      pending.set(id, resolve);
      socket.send(JSON.stringify({ id, method, params }));
    });

  await send("Page.enable");
  await send("Page.navigate", { url: pageUrl });

  let dataUrl = null;
  for (let attempt = 0; attempt < 40 && !dataUrl; attempt += 1) {
    await sleep(1000);
    const reply = await send("Runtime.evaluate", { expression: capture, awaitPromise: true, returnByValue: true });
    const value = reply.result?.result?.value;
    // A blank canvas encodes to a tiny image; wait until the model has actually drawn.
    if (value && value.length > 3000) dataUrl = value;
  }
  if (!dataUrl) throw new Error("The viewer never rendered a model.");

  mkdirSync(path.dirname(output), { recursive: true });
  writeFileSync(output, Buffer.from(dataUrl.split(",")[1], "base64"));
  console.log(`wrote ${path.relative(process.cwd(), output)} (${Math.round(dataUrl.length * 0.75)} bytes)`);
  socket.close();
} finally {
  child.kill();
}
