import { Request, Response, NextFunction } from "express";

interface HttpError extends Error {
  status?: number;
}

// Centralized error handler. Controllers/services should throw; this formats the response.
export function errorHandler(
  err: HttpError,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  console.error(err);

  const status = err.status || 500;
  const message =
    status === 500 ? "Internal server error" : err.message || "Something went wrong";

  res.status(status).json({ error: message });
}
