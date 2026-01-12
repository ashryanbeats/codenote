import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const getRequestUrl = (req: unknown, res: unknown) => {
  if (isRecord(req) && typeof req.url === "string") {
    return req.url;
  }
  if (isRecord(res) && isRecord(res.req) && typeof res.req.url === "string") {
    return res.req.url;
  }
  return "";
};

const isAbortError = (err: unknown) => {
  if (!isRecord(err)) return false;
  const name = typeof err.name === "string" ? err.name : "";
  const code = typeof err.code === "string" ? err.code : "";
  return name === "AbortError" || code === "ECONNRESET";
};

const isRequestAborted = (req: unknown) => {
  if (!isRecord(req)) return false;
  const aborted = req.aborted === true;
  const destroyed = req.destroyed === true;
  return aborted || destroyed;
};

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  worker: {
    format: "es",
  },
  server: {
    // so the browser can call the Deno API during dev
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        configure: (proxy) => {
          type ProxyOn = (eventName: string, listener: (...args: unknown[]) => void) => unknown;

          const originalOn = proxy.on.bind(proxy) as unknown as ProxyOn;
          const wrappedOn: ProxyOn = (eventName, listener) => {
            if (eventName === "error") {
              const wrappedListener = (...args: unknown[]) => {
                const [err, req, res] = args;
                const url = getRequestUrl(req, res);
                const isAbort =
                  isRequestAborted(req) &&
                  isAbortError(err) &&
                  url.startsWith("/api/");

                if (isAbort) {
                  return;
                }

                listener(...args);
              };

              return originalOn(eventName, wrappedListener);
            }

            return originalOn(eventName, listener);
          };

          proxy.on = wrappedOn as unknown as typeof proxy.on;
        },
      },
    },
  },
});
