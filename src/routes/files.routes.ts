import { Router } from "express";
import { optionalUserAuth, requireAnyAuth } from "../middleware/auth.middleware";
import { uploadImage, uploadMedia, handleMulterError } from "../middleware/upload.middleware";
import { serveFile, uploadImageHandler, uploadMediaHandler } from "../controllers/files.controller";

// Public file serving: GET /files/<key>
export const filesRouter = Router();
filesRouter.get("/*", serveFile);

// Authenticated uploads (seller dashboard + mobile app): POST /uploads/image
export const uploadsRouter = Router();
uploadsRouter.post("/image", requireAnyAuth, uploadImage, uploadImageHandler);
uploadsRouter.post("/media", optionalUserAuth, uploadMedia, uploadMediaHandler);
uploadsRouter.post("/review-media", optionalUserAuth, uploadMedia, uploadMediaHandler);
uploadsRouter.use(handleMulterError);
