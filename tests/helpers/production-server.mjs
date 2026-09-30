import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { openCanonicalTestDatabase } from "./canonical-database.mjs";
import { sqliteD1 } from "./sqlite-d1.mjs";
import worker from "../../dist/server/index.js";

const root = process.cwd();
const database = openCanonicalTestDatabase(root);
const assets = path.join(root, "dist/client");
const contentTypes = { ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".json": "application/json" };
async function asset(request) {
  const file = path.resolve(assets, `.${decodeURIComponent(new URL(request.url).pathname)}`);
  if (!file.startsWith(`${assets}${path.sep}`)) return new Response(null, { status: 404 });
  try { return new Response(await readFile(file), { headers: { "Content-Type": contentTypes[path.extname(file)] ?? "application/octet-stream" } }); }
  catch { return new Response(null, { status: 404 }); }
}
const env = {
  DB: sqliteD1(database), ASSETS: { fetch: asset },
  ADMIN_EMAIL: process.env.ADMIN_EMAIL,
  GOOGLE_AUTH_SESSION_SECRET: process.env.GOOGLE_AUTH_SESSION_SECRET,
};
const server = createServer(async (incoming, outgoing) => {
  try {
    const chunks = [];
    for await (const chunk of incoming) chunks.push(chunk);
    const url = `http://127.0.0.1:4174${incoming.url}`;
    const request = new Request(url, {
      method: incoming.method, headers: incoming.headers,
      ...(["GET", "HEAD"].includes(incoming.method) ? {} : { body: Buffer.concat(chunks) }),
    });
    let response = await asset(request);
    if (response.status === 404) response = await worker.fetch(request, env, { waitUntil() {}, passThroughOnException() {} });
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) { console.error(error); outgoing.writeHead(500); outgoing.end("Local test server error"); }
});
server.listen(4174, "127.0.0.1", () => console.log("Production Worker with local canonical D1: http://127.0.0.1:4174"));
process.on("SIGTERM", () => server.close(() => { database.close(); process.exit(0); }));
