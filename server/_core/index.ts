import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { handleStripeWebhook } from "../webhooks/stripe";
import { injectOgMetaTags } from "../middleware/ogMetaTags";
import { getOrderById } from "../db";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
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
  // Stripe webhook - must be before json body parser for raw body
  app.post("/api/stripe/webhook", express.raw({ type: "application/json" }), handleStripeWebhook);
  app.post("/api/webhooks/stripe", express.raw({ type: "application/json" }), handleStripeWebhook);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  // OAuth callback under /api/oauth/callback
  registerOAuthRoutes(app);
  // Download proxy for video and character image (bypasses CORS)
  app.get("/api/download/:orderId/:type", async (req, res) => {
    try {
      const orderId = parseInt(req.params.orderId);
      const type = req.params.type; // "video" or "character"
      if (!orderId || isNaN(orderId)) {
        return res.status(400).json({ error: "Invalid order ID" });
      }

      const order = await getOrderById(orderId);
      if (!order) {
        return res.status(404).json({ error: "Order not found" });
      }
      if (order.paymentStatus !== "paid") {
        return res.status(403).json({ error: "Order not paid" });
      }

      let sourceUrl: string | null = null;
      let filename: string;
      let contentType: string;
      const safeName = (order.childName || "storybook").replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();

      if (type === "video") {
        sourceUrl = order.videoUrl;
        filename = `${safeName}_storybook.mp4`;
        contentType = "video/mp4";
      } else if (type === "character") {
        sourceUrl = order.generatedImageUrl;
        filename = `${safeName}_animated_character.png`;
        contentType = "image/png";
      } else {
        return res.status(400).json({ error: "Invalid download type" });
      }

      if (!sourceUrl) {
        return res.status(404).json({ error: `${type} not available yet` });
      }

      // Fetch from S3 and stream to client
      const upstream = await fetch(sourceUrl);
      if (!upstream.ok) {
        return res.status(502).json({ error: "Failed to fetch file from storage" });
      }

      res.setHeader("Content-Type", contentType);
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      if (upstream.headers.get("content-length")) {
        res.setHeader("Content-Length", upstream.headers.get("content-length")!);
      }

      // Stream the response body
      const reader = upstream.body?.getReader();
      if (!reader) {
        return res.status(502).json({ error: "No response body" });
      }

      const pump = async () => {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(value);
        }
        res.end();
      };
      await pump();
    } catch (error) {
      console.error("[Download] Error:", error);
      if (!res.headersSent) {
        res.status(500).json({ error: "Download failed" });
      }
    }
  });

  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // Inject OG meta tags for share pages (must be before Vite/static)
  app.use(injectOgMetaTags);

  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
