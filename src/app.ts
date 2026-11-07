import path from "path";
import fs from "fs";
import express from "express";
import cors from "cors";
import morgan from "morgan";
import routes from "./routes/index";
import { errorHandler } from "./middleware/error.middleware";
import { buildCorsOptions } from "./config/cors";
import { config } from "./config/env";

const app = express();

app.use((_req, res, next) => {
  res.setHeader("ngrok-skip-browser-warning", "true");
  next();
});

// CORS allowlist from CORS_ORIGIN (see config/cors.ts). Read per request so a test or a
// config reload sees the current env.
app.use((req, res, next) =>
  cors(buildCorsOptions({ corsOrigin: process.env.CORS_ORIGIN ?? config.corsOrigin, isProduction: config.isProduction }))(req, res, next)
);
app.use(
  express.json({
    limit: "50mb",
    // Keep the exact request bytes: webhook signatures (Razorpay X-Razorpay-Signature) are an
    // HMAC over the raw body, and re-serialising the parsed JSON does not reproduce it.
    verify: (req, _res, buf) => {
      (req as express.Request).rawBody = buf;
    },
  })
);
app.use(express.urlencoded({ limit: "50mb", extended: true }));
app.use(morgan("dev"));

app.get("/health", (_req, res) => res.json({ status: "ok" }));

// Serve uploaded files statically
const tmpUploadsDir = path.resolve("/tmp", "uploads");
if (!fs.existsSync(tmpUploadsDir)) {
  try {
    fs.mkdirSync(tmpUploadsDir, { recursive: true });
  } catch {}
}
app.use("/uploads", express.static(tmpUploadsDir));
app.use("/uploads", express.static(path.resolve(process.cwd(), "uploads")));

// API v1 routes
app.use("/api", routes);
app.use("/api/v1", routes);


app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

app.use(errorHandler);

export default app;

