import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { storageService } from "../external";
import { isSafeKey } from "../external/storage/storage.utils";
import { uploadFile } from "../services/upload.service";

// Folders a client may upload into via POST /uploads/image.
const IMAGE_FOLDERS = ["images", "products", "logos", "avatars"] as const;

// GET /files/<key> — public, streams a stored file (product images, logos).
// Keys are unguessable (timestamp + namespaced by owner), and served with a
// locked-down CSP so an uploaded SVG cannot run script on the API origin.
export const serveFile = asyncHandler(async (req: Request, res: Response) => {
  const key = (req.params as Record<string, string>)[0];
  if (!isSafeKey(key)) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const object = await storageService.getObject(key);
  if (!object) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  res.setHeader("Content-Type", object.contentType || "application/octet-stream");
  if (object.contentLength !== undefined) res.setHeader("Content-Length", String(object.contentLength));
  if (object.etag) res.setHeader("ETag", object.etag);
  // Keys include an upload timestamp, so content at a key never changes.
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");

  object.body.on("error", (err) => {
    console.error(`[Files] Stream failed for ${key}:`, err);
    res.destroy(err);
  });
  object.body.pipe(res);
});

// POST /uploads/image — multipart field "image"; seller or mobile-user JWT.
// Optional ?folder=products|logos|avatars (default "images"). Returns { url, key }.
export const uploadImageHandler = asyncHandler(async (req: Request, res: Response) => {
  if (!req.file) {
    res.status(400).json({ error: "No file uploaded (expected multipart field \"image\")" });
    return;
  }

  const requested = typeof req.query.folder === "string" ? req.query.folder : "images";
  if (!(IMAGE_FOLDERS as readonly string[]).includes(requested)) {
    res.status(400).json({ error: `Invalid folder. Allowed: ${IMAGE_FOLDERS.join(", ")}` });
    return;
  }

  // Namespace by owner: sellers/<id> or users/<id>.
  const entityId = req.seller ? `seller-${req.seller.id}` : `user-${req.user!.id}`;

  const result = await uploadFile({ file: req.file, folder: requested, entityId });
  res.status(201).json({ url: result.url, key: result.key });
});
