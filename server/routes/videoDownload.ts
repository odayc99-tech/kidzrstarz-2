import type { Express, Request, Response } from "express";
import { getOrderById, getOrderByGuestToken } from "../db";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { sdk } from "../_core/sdk";

/**
 * Register a download route for completed storybook videos.
 * GET /api/download/video/:orderId?guestToken=...
 *
 * Generates a short-lived pre-signed S3 URL with ResponseContentDisposition=attachment
 * and redirects the browser to it. This forces a file download (not inline playback)
 * without proxying the video through the server (avoids Cloud Run 60s timeout).
 *
 * Note: The video player uses the direct public S3 URL (never expires).
 * This endpoint is only for the download button, so a 5-minute pre-signed URL is fine.
 *
 * Access control:
 *  - Authenticated users: must own the order (or be admin)
 *  - Guest users: must provide a valid guestToken matching the order
 */
export function registerVideoDownloadRoute(app: Express) {
  app.get("/api/download/video/:orderId", async (req: Request, res: Response) => {
    try {
      const orderId = parseInt(req.params.orderId, 10);
      if (!orderId || isNaN(orderId)) {
        res.status(400).json({ error: "Invalid order ID" });
        return;
      }

      const guestToken = req.query.guestToken as string | undefined;

      // Load the order
      const order = await getOrderById(orderId);
      if (!order) {
        res.status(404).json({ error: "Order not found" });
        return;
      }

      // --- Access control ---
      let authorized = false;

      if (guestToken) {
        // Guest access: validate the guest token matches this order
        const guestOrder = await getOrderByGuestToken(guestToken);
        if (guestOrder && guestOrder.id === orderId) {
          authorized = true;
        }
      }

      if (!authorized) {
        // Authenticated access: verify session and check ownership
        try {
          const user = await sdk.authenticateRequest(req);
          if (user.role === "admin" || order.userId === user.id) {
            authorized = true;
          }
        } catch {
          // Not authenticated — fall through to 403
        }
      }

      if (!authorized) {
        res.status(403).json({ error: "Unauthorized" });
        return;
      }
      // --- End access control ---

      if (!order.videoKey) {
        // No S3 key — video not ready yet
        res.status(404).json({ error: "Video not ready yet" });
        return;
      }

      // Build a pre-signed URL with ResponseContentDisposition so the browser
      // downloads the file with a friendly filename instead of opening it inline.
      const region = process.env.S3_REGION;
      const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
      const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
      const bucket = process.env.S3_BUCKET;

      if (!region || !accessKeyId || !secretAccessKey || !bucket) {
        res.status(500).json({ error: "Storage credentials not configured" });
        return;
      }

      const childName = order.childName || "storybook";
      const filename = `${childName.replace(/[^a-z0-9]/gi, "-").toLowerCase()}-animated-story.mp4`;
      const key = order.videoKey.replace(/^\/+/, "");

      const client = new S3Client({
        region,
        credentials: { accessKeyId, secretAccessKey },
      });

      const downloadUrl = await getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
          ResponseContentDisposition: `attachment; filename="${filename}"`,
          ResponseContentType: "video/mp4",
        }),
        { expiresIn: 300 } // 5-minute download link
      );

      // Redirect the browser to the pre-signed URL — the browser will
      // download the file directly from S3 without going through the server.
      res.redirect(302, downloadUrl);
    } catch (err) {
      console.error("[VideoDownload] Error:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  });
}
