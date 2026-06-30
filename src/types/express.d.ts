import { Request, Response, NextFunction } from "express";

// Augment the Express Request type so TypeScript knows about req.seller
// everywhere in the app without manual casting.
declare global {
  namespace Express {
    interface Request {
      seller: { id: string };
    }
  }
}

export {};
