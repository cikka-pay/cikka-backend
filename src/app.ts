import express from "express";
import cors from "cors";
import morgan from "morgan";
import path from "path";
import routes from "./routes/index";
import { errorHandler } from "./middleware/error.middleware";

const app = express();

const allowedOrigins = (process.env.CORS_ORIGIN || "http://localhost:5173").split(",");

app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json());
app.use(morgan("dev"));

// Serve uploaded assets statically
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

app.get("/health", (_req, res) => res.json({ status: "ok" }));

app.use("/api", routes);

app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

app.use(errorHandler);

export default app;
