import { Request, Response, NextFunction } from "express";
import { getDb } from "../db";
import { orders } from "../../drizzle/schema";
import { eq } from "drizzle-orm";

const LOGO_URL =
  "https://d2xsxph8kpxj0f.cloudfront.net/310519663488009170/4GL2mPjHtW2yMjS2aSQkPm/kidzrstarz-logo_5f53c312.png";

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Middleware that intercepts requests to /share/:token and injects
 * Open Graph + Twitter Card meta tags into the HTML template.
 *
 * Social media crawlers (Facebook, Twitter, iMessage, etc.) read these
 * tags from the initial HTML response before any JavaScript executes.
 */
export function injectOgMetaTags(
  req: Request,
  res: Response,
  next: NextFunction
) {
  // Only intercept /share/:token routes
  const shareMatch = req.originalUrl.match(/^\/share\/([a-zA-Z0-9_-]+)/);
  if (!shareMatch) {
    return next();
  }

  const shareToken = shareMatch[1];

  // Store the original res.send/end to intercept HTML responses
  const originalSend = res.send.bind(res);

  res.send = function (body: any) {
    // Only modify HTML responses
    if (
      typeof body === "string" &&
      body.includes("<!-- OG_META_TAGS -->")
    ) {
      // Fetch order data and inject OG tags
      fetchShareData(shareToken)
        .then((ogTags) => {
          const modifiedBody = body
            .replace("<!-- OG_META_TAGS -->", ogTags.metaTags)
            .replace("<title>KidzRstarz</title>", `<title>${ogTags.title}</title>`);
          return originalSend(modifiedBody);
        })
        .catch(() => {
          // On error, serve the page without OG tags (fallback to defaults)
          const fallbackTags = buildDefaultOgTags(req);
          const modifiedBody = body
            .replace("<!-- OG_META_TAGS -->", fallbackTags);
          return originalSend(modifiedBody);
        });
    } else {
      return originalSend(body);
    }
  } as any;

  next();
}

interface OgData {
  title: string;
  metaTags: string;
}

async function fetchShareData(shareToken: string): Promise<OgData> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  const result = await db
    .select({
      childName: orders.childName,
      story: orders.story,
      storyTheme: orders.storyTheme,
      generatedImageUrl: orders.generatedImageUrl,
    })
    .from(orders)
    .where(eq(orders.shareToken, shareToken))
    .limit(1);

  if (result.length === 0) {
    throw new Error("Storybook not found");
  }

  const order = result[0];
  const childName = order.childName || "A Child";
  const theme = order.storyTheme || "adventure";
  const themeLabel = theme.charAt(0).toUpperCase() + theme.slice(1).replace(/_/g, " ");

  const title = `${escapeHtml(childName)}'s ${escapeHtml(themeLabel)} Storybook | KidzRstarz`;

  // Create a short description from the story (first 160 chars)
  let description = `Watch ${escapeHtml(childName)}'s magical Pixar-style animated storybook — a personalized ${themeLabel.toLowerCase()} story with narration and music!`;
  if (order.story) {
    const storyPreview = order.story.substring(0, 150).replace(/\n/g, " ").trim();
    description = `${escapeHtml(storyPreview)}${order.story.length > 150 ? "..." : ""}`;
  }

  // Use the generated character image if available, otherwise the logo
  const imageUrl = order.generatedImageUrl || LOGO_URL;

  const metaTags = buildOgTags({
    title,
    description,
    imageUrl,
    url: `/share/${shareToken}`,
  });

  return { title, metaTags };
}

interface OgTagParams {
  title: string;
  description: string;
  imageUrl: string;
  url: string;
}

function buildOgTags(params: OgTagParams): string {
  const { title, description, imageUrl, url } = params;

  return `
    <!-- Open Graph -->
    <meta property="og:type" content="website" />
    <meta property="og:title" content="${title}" />
    <meta property="og:description" content="${description}" />
    <meta property="og:image" content="${escapeHtml(imageUrl)}" />
    <meta property="og:url" content="${escapeHtml(url)}" />
    <meta property="og:site_name" content="KidzRstarz" />

    <!-- Twitter Card -->
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${title}" />
    <meta name="twitter:description" content="${description}" />
    <meta name="twitter:image" content="${escapeHtml(imageUrl)}" />

    <!-- General -->
    <meta name="description" content="${description}" />`;
}

function buildDefaultOgTags(req: Request): string {
  return buildOgTags({
    title: "KidzRstarz — Where Every Kid Becomes a Star",
    description:
      "Transform your child into a Pixar-style character with a personalized animated storybook featuring narration and music!",
    imageUrl: LOGO_URL,
    url: req.originalUrl,
  });
}
