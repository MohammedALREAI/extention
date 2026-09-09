import "dotenv/config";
import express from "express";
import type { NextFunction, Request, Response } from "express";
import { createServer } from "http";
import net from "net";
import path from "node:path";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { registerExtensionSemanticApi } from "../extensionSemanticApi";
import { registerDeveloperModerationApi } from "../developerModerationApi";
import { registerImageDetectionApi } from "../imageDetectionApi";

function analyticsOrigin(endpoint = process.env.VITE_ANALYTICS_ENDPOINT) {
  try {
    return endpoint ? new URL(endpoint).origin : undefined;
  } catch {
    return undefined;
  }
}

export function productionContentSecurityPolicy(endpoint = process.env.VITE_ANALYTICS_ENDPOINT) {
  const analytics = analyticsOrigin(endpoint);
  const analyticsSource = analytics ? ` ${analytics}` : "";
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "frame-src 'none'",
    "img-src 'self' data: blob: https:",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    `script-src 'self'${analyticsSource}`,
    // The app and its API share an origin, so 'self' is all the page needs. Naming
    // extra hosts here only widened where the page was allowed to connect.
    `connect-src 'self'${analyticsSource}`,
  ].join("; ");
}

export function applySecurityHeaders(request: Request, response: Response, next: NextFunction) {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (process.env.NODE_ENV === "production") {
    response.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    response.setHeader("Content-Security-Policy", productionContentSecurityPolicy());
  }
  next();
}

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3001): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  app.use(applySecurityHeaders);
  // Express decodes path params before any route matches, so a stray percent sign in a
  // URL throws a URIError from deep inside its router with no route to catch it. Any
  // client can send one, so it is rejected here rather than logged as a crash.
  app.use((req, res, next) => {
    try {
      decodeURIComponent(req.path);
    } catch {
      return res.status(400).json({ error: "Malformed URL." });
    }
    next();
  });
  app.use((req, res, next) => {
    if (req.path.startsWith("/api")) {
      const start = Date.now();
      res.on("finish", () => {
        console.log(`[API] ${req.method} ${req.path} -> ${res.statusCode} (${Date.now() - start}ms)`);
      });
    }
    next();
  });
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  registerStorageProxy(app);
  registerOAuthRoutes(app);
  registerExtensionSemanticApi(app);
  registerDeveloperModerationApi(app);
  registerImageDetectionApi(app);
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV !== "production") {
    // The acceptance fixture lives outside the Vite root, so without this it falls
    // through to the SPA and silently renders the app instead of the test page.
    app.use("/eval", express.static(path.resolve(import.meta.dirname, "..", "..", "eval")));
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3001");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

if (!process.env.VITEST) {
  startServer().catch(console.error);
}
