/**
 * Child process behind local-registry.ts: serves one package tarball as an npm registry.
 * Usage: node registry-server.ts <tarball> <manifest.json> <port-file>
 */

import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";

const [ tarballPath, manifestPath, portFile ] = process.argv.slice(2);
if (!tarballPath || !manifestPath || !portFile) throw new Error("usage: registry-server.ts <tarball> <manifest.json> <port-file>");

const tarball = fs.readFileSync(tarballPath);
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as { name: string; version: string; };
const integrity = `sha512-${crypto.createHash("sha512").update(tarball)
  .digest("base64")}`;
const published = new Date().toISOString();

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url ?? "");
  if (url === "/package.tgz") {
    res.writeHead(200, { "content-type": "application/octet-stream" }).end(tarball);
    return;
  }
  if (url !== `/${manifest.name}`) {
    res.writeHead(404).end();
    return;
  }
  const { port } = server.address() as { port: number; };
  const dist = { tarball: `http://127.0.0.1:${port}/package.tgz`, integrity };
  res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({
    "name": manifest.name,
    "dist-tags": { latest: manifest.version },
    "versions": { [manifest.version]: { ...manifest, dist } },
    "time": { created: published, modified: published, [manifest.version]: published },
  }));
});

server.listen(0, "127.0.0.1", () => {
  fs.writeFileSync(portFile, String((server.address() as { port: number; }).port));
});
