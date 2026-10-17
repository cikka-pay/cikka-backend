import { Router } from "express";
import { requireAnyAuth } from "../middleware/auth.middleware";
import { uploadImage, handleMulterError } from "../middleware/upload.middleware";
import { serveFile, uploadImageHandler } from "../controllers/files.controller";

// Public file serving: GET /files/<key>
export const filesRouter = Router();
filesRouter.get("/*", serveFile);

// Authenticated uploads (seller dashboard + mobile app): POST /uploads/image
export const uploadsRouter = Router();
uploadsRouter.post("/image", requireAnyAuth, uploadImage, uploadImageHandler);
uploadsRouter.use(handleMulterError);
