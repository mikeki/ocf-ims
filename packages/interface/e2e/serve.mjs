// SPDX-License-Identifier: Apache-2.0

// The static server behind the local Playwright runs — the CI smoke and the
// tracer's interim mode. It serves dist/ with the single-page fallback the
// hosted build's Caddy has (`try_files {path} /index.html`), which
// `expo serve` lacks: that one answers 404 to any path that is not a file, so
// a deep link such as /events/1/incidents/202 never reaches the app. Only a
// GET or HEAD for a file or a page is answered; everything else (a Connect
// call made to this origin, in the smoke's "nothing behind the RPCs" mode) is
// a 404, as before.
//
//   node e2e/serve.mjs [port] [dir]     (defaults: 8082, dist)

import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";

const port = Number(process.argv[2] ?? 8082);
const root = resolve(process.argv[3] ?? "dist");

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".map": "application/json",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};

function fileAt(path) {
  try {
    return statSync(path).isFile() ? path : undefined;
  } catch {
    return undefined;
  }
}

function notFound(res) {
  res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  res.end("Not Found");
}

createServer((req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    notFound(res);
    return;
  }
  const pathname = decodeURIComponent(
    new URL(req.url ?? "/", "http://localhost").pathname,
  );
  // Keep the lookup inside the root.
  const relative = normalize(pathname).replace(/^(\.\.[/\\])+/, "");
  const target = join(root, relative);
  const file =
    fileAt(target) ??
    (extname(relative) === "" ? fileAt(join(root, "index.html")) : undefined);
  if (!file?.startsWith(root)) {
    notFound(res);
    return;
  }
  res.writeHead(200, {
    "content-type": contentTypes[extname(file)] ?? "application/octet-stream",
    "cache-control": "no-store",
  });
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  createReadStream(file).pipe(res);
}).listen(port, () => {
  console.log(`serving ${root} on http://localhost:${port}`);
});
