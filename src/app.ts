import express from "express";
import cors from "cors";
import morgan from "morgan";
import routes from "./routes/index";
import setuRoutes from "./routes/setu.routes";
import { errorHandler } from "./middleware/error.middleware";
import { config } from "./config/env";

const app = express();

const envOrigins = config.corsOrigin.split(",").map((o) => o.trim()).filter(Boolean);

// Local / tunnel hosts used while developing the dashboard and the Expo app.
function isDevOrigin(origin: string): boolean {
  let host: string;
  try {
    host = new URL(origin).hostname;
  } catch {
    return false;
  }
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    /^10\.\d+\.\d+\.\d+$/.test(host) ||
    /^192\.168\.\d+\.\d+$/.test(host) ||
    host.endsWith(".ngrok-free.app") ||
    host.endsWith(".ngrok.io") ||
    host.endsWith(".ngrok.app") ||
    host.endsWith(".exp.direct")
  );
}

app.use((_req, res, next) => {
  res.setHeader("ngrok-skip-browser-warning", "true");
  next();
});

app.use(cors({
  origin: (origin, callback) => {
    // Native apps, curl and server-to-server calls send no Origin header.
    if (!origin) return callback(null, true);
    if (envOrigins.includes(origin) || envOrigins.includes("*")) return callback(null, true);
    if (!config.isProduction && isDevOrigin(origin)) return callback(null, true);
    return callback(null, false);
  },
  credentials: true,
}));
app.use(
  express.json({
    limit: "50mb",
    // Keep the exact bytes so webhook signatures (Razorpay) can be verified.
    verify: (req, _res, buf) => {
      (req as any).rawBody = buf;
    },
  })
);
app.use(express.urlencoded({ limit: "50mb", extended: true }));
app.use(morgan("dev"));

app.get("/health", (_req, res) => res.json({ status: "ok" }));

// Direct Setu endpoint matching POST {ourBaseURL}/setu/v1/*
app.use("/setu/v1", setuRoutes);

// API v1 routes
app.use("/api", routes);
app.use("/api/v1", routes);


app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

app.use(errorHandler);

export default app;

