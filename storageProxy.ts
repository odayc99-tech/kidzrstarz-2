import type { Express } from "express";
import { storageGet } from "../storage";

/**
 * Provides a /manus-storage/* proxy route that redirects to a fresh AWS S3
 * pre-signed URL.  This keeps backward-compatibility with any code that
 * still references /manus-storage/ paths stored in the database.
 */
export function registerStorageProxy(app: Express) {
  app.get("/manus-storage/*", async (req, res) => {
    const key = (req.params as Record<string, string>)[0];
    if (!key) {
      res.status(400).send("Missing storage key");
      return;
    }

    try {
      const { url } = await storageGet(key);
      res.set("Cache-Control", "no-store");
      res.redirect(307, url);
    } catch (err) {
      console.error("[StorageProxy] failed:", err);
      res.status(502).send("Storage proxy error");
    }
  });
}
