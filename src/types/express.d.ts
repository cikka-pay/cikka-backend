import { Request, Response, NextFunction } from "express";

// Augment the Express Request type so TypeScript knows about req.seller and req.customer
// everywhere in the app without manual casting.
declare global {
  namespace Express {
    interface Request {
      seller?: { id: string };
      customer?: { id: string };
    }
  }
}

export {};

