/**
 * 零依赖静态服务器
 * 用法：node scripts/serve.js [port]
 * ES modules 与 fetch 都受同源策略约束，直接双击 index.html 是跑不起来的。
 */

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("../", import.meta.url)));

// 同时接受 `node scripts/serve.js 8080` 与 `node scripts/serve.js --port=8080`
const portArg = process.argv.slice(2).find((a) => !a.startsWith("--"));
const portFlag = (process.argv.find((a) => a.startsWith("--port=")) || "").split("=")[1];
const PORT = Number(portArg || portFlag || process.env.PORT || 5173);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

export function createStaticServer() {
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      let path = decodeURIComponent(url.pathname);
      if (path === "/") path = "/index.html";

      // 防目录穿越
      const full = join(ROOT, normalize(path).replace(/^(\.\.[/\\])+/, ""));
      if (!full.startsWith(ROOT)) {
        res.writeHead(403).end("Forbidden");
        return;
      }

      const info = await stat(full).catch(() => null);
      if (!info || !info.isFile()) {
        res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("404 Not Found: " + path);
        return;
      }

      const body = await readFile(full);
      res.writeHead(200, {
        "content-type": MIME[extname(full).toLowerCase()] || "application/octet-stream",
        "content-length": body.length,
        "cache-control": "no-cache",
      });
      res.end(body);
    } catch (err) {
      res.writeHead(500, { "content-type": "text/plain; charset=utf-8" }).end("500 " + err.message);
    }
  });
}

// 直接执行时启动；被 verify.js import 时只导出工厂
if (import.meta.url === `file://${process.argv[1]}`) {
  const server = createStaticServer();
  server.listen(PORT, () => {
    console.log(`\n  Bar Chart Race Studio`);
    console.log(`  \x1b[36mhttp://localhost:${PORT}\x1b[0m\n`);
  });
}
