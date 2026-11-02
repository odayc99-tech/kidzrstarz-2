import type { Express } from "express";
import { getOrderById } from "../db";
import { sdk } from "../_core/sdk";
import { privateDownloadUrl } from "../services/privateMediaDelivery";

/** Backward-compatible route, now with authorization and canonical-key downloads. */
export function registerPrivateDownloads(app: Express) {
  app.get("/api/download/:orderId/:type", async (req, res) => {
    try {
      const orderId = Number(req.params.orderId);
      const kind = req.params.type;
      if (!Number.isInteger(orderId) || orderId <= 0 || !["video", "character"].includes(kind)) {
        return res.status(400).json({ error: "Invalid download request" });
      }
      const order = await getOrderById(orderId);
      if (!order) return res.status(404).json({ error: "Order not found" });
      let authorized = typeof req.query.guestToken === "string" && !!order.guestToken && req.query.guestToken === order.guestToken;
      if (!authorized) {
        try {
          const user = await sdk.authenticateRequest(req);
          authorized = user.role === "admin" || order.userId === user.id;
        } catch { /* No authenticated session. */ }
      }
      if (!authorized) return res.status(403).json({ error: "Unauthorized" });
      if (order.paymentStatus !== "paid") return res.status(403).json({ error: "Order not paid" });
      const key = kind === "video" ? order.videoKey : order.generatedImageKey;
      if (!key) return res.status(404).json({ error: "Media not ready yet" });
      const name = (order.childName || "storybook").replace(/[^a-zA-Z0-9]/g, "-").toLowerCase();
      const filename = kind === "video" ? `${name}-storybook.mp4` : `${name}-animated-character.png`;
      const { downloadUrl } = await privateDownloadUrl(key, filename, kind === "video" ? "video/mp4" : "image/png");
      res.setHeader("Cache-Control", "no-store");
      return res.redirect(302, downloadUrl);
    } catch (error) {
      console.error("[Download] Private download failed", error instanceof Error ? error.name : "Error");
      if (!res.headersSent) return res.status(500).json({ error: "Download unavailable. Please try again." });
    }
  });
}
