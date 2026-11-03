// Tiny static dev server (no dependencies). Usage: npm run dev  [PORT=5173]
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(import.meta.url), "..", "..");
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".lottie": "application/zip" };
const port = +process.env.PORT || 5173;

createServer(async (req, res) => {
  try {
    let p = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^(\.\.[/\\])+/, "");
    let f = join(root, p);
    if (!f.startsWith(root)) throw new Error("forbidden");
    if ((await stat(f).catch(() => null))?.isDirectory()) f = join(f, "index.html");
    const data = await readFile(f);
    res.writeHead(200, { "Content-Type": types[extname(f)] || "application/octet-stream", "Cache-Control": "no-store" }); res.end(data);
  } catch { res.writeHead(404); res.end("Not found"); }
}).listen(port, () => console.log(`Dev server: http://localhost:${port}`));
