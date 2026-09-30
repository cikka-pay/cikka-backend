import express from "express";
import cors from "cors";
import morgan from "morgan";
import routes from "./routes/index";
import setuRoutes from "./routes/setu.routes";
import { errorHandler } from "./middleware/error.middleware";

const app = express();

const envOrigins = (process.env.CORS_ORIGIN || "http://localhost:5173").split(",").map(o => o.trim());

app.use((_req, res, next) => {
  res.setHeader("ngrok-skip-browser-warning", "true");
  next();
});

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (
      envOrigins.includes(origin) ||
      envOrigins.includes('*') ||
      origin.includes('localhost') ||
      origin.includes('127.0.0.1') ||
      origin.includes('10.') ||
      origin.includes('192.168.') ||
      origin.includes('ngrok') ||
      origin.includes('exp.direct')
    ) {
      return callback(null, true);
    }
    return callback(null, true);
  },
  credentials: true,
}));
app.use(express.json({ limit: "50mb" }));
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

