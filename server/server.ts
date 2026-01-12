import { serveDir, serveFile } from "@std/http/file-server";
import { handleApi } from "./api.ts";
import { env } from "./env.ts";

const PORT = Number(env("PORT"));
const DIST_DIR = "dist";
const INDEX_HTML = `${DIST_DIR}/index.html`;

function logRequest(req: Request, status: number, startMs: number, note?: string) {
  const url = new URL(req.url);
  const duration = Math.round(performance.now() - startMs);
  const suffix = note ? ` (${note})` : "";
  console.log(`${req.method} ${url.pathname}${url.search} -> ${status} ${duration}ms${suffix}`);
}

async function fileExists(path: string) {
  try {
    const s = await Deno.stat(path);
    return s.isFile;
  } catch {
    return false;
  }
}

Deno.serve({ port: PORT }, async (req) => {
  const start = performance.now();

  // 1) API first
  try {
    const apiRes = await handleApi(req);
    if (apiRes) {
      logRequest(req, apiRes.status, start, "api");
      return apiRes;
    }
  } catch (error) {
    logRequest(req, 500, start, "api error");
    console.error(error);
    return new Response("Internal Server Error", { status: 500 });
  }

  // 2) In dev, you’ll typically run Vite separately and let it serve the UI.
  // This server is primarily for prod (serving dist/) and API.

  // 3) Serve static assets (dist/)
  const url = new URL(req.url);
  if (url.pathname !== "/" && url.pathname !== "") {
    const res = await serveDir(req, { fsRoot: DIST_DIR });
    if (res.status !== 404) {
      logRequest(req, res.status, start, "static");
      return res;
    }
  }

  // 4) SPA fallback
  if (!(await fileExists(INDEX_HTML))) {
    const res = new Response(
      "UI build output not found. Run `deno task build` (or `deno task dev:web` in dev).",
      { status: 500 }
    );
    logRequest(req, res.status, start, "spa fallback missing");
    return res;
  }

  const res = await serveFile(req, INDEX_HTML);
  logRequest(req, res.status, start, "spa");
  return res;
});

console.log(`✅ API server: http://localhost:${PORT}`);
