const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const morgan = require("morgan");
const path = require("path");
const fs = require("fs").promises;
require("dotenv").config();

const imageRoutes = require("./routes/imageRoutes");
const { scheduleCleanup } = require("./utils/fileCleanup");

const app = express();

// Environment setup
const HOST = process.env.HOST || "127.0.0.1";
const PORT = parseInt(process.env.PORT, 10) || 5000;
const NODE_ENV = process.env.NODE_ENV || "development";
const TRUST_PROXY = process.env.TRUST_PROXY === "true";

// Trust proxy for headers
if (TRUST_PROXY) app.set("trust proxy", 1);

// Initialize directories
const initializeDirectories = async () => {
  const dirs = ["temp/uploads", "public/processed"].map((dir) =>
    path.join(__dirname, dir)
  );
  for (const dir of dirs) {
    try {
      await fs.mkdir(dir, { recursive: true });
      console.log(`[Server] Initialized ${dir}`);
    } catch (error) {
      console.error(`[Server] Failed to init ${dir}: ${error.message}`);
    }
  }
};
initializeDirectories();

// Security
app.use(
  helmet({
    contentSecurityPolicy: NODE_ENV === "production" ? undefined : false,
  })
);

// CORS
const allowedOrigins = (
  process.env.CORS_ORIGINS ||
  "http://localhost:5000,http://localhost:5001,https://pixeeaibackend.depaymprotocol.com"
)
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, cb) =>
      allowedOrigins.includes(origin) || !origin
        ? cb(null, true)
        : cb(new Error("CORS not allowed"), false),
    credentials: true,
  })
);

// Rate limiting
app.use(
  "/api/images",
  rateLimit({
    windowMs: parseInt(process.env.RATE_WINDOW_MS, 10) || 15 * 60 * 1000,
    max: parseInt(process.env.RATE_MAX, 10) || 100,
    message: { error: "Too many requests" },
    standardHeaders: true,
  })
);

// Logging
app.use(morgan(NODE_ENV === "production" ? "combined" : "dev"));

// Body parsing
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Static files
app.use(
  "/processed",
  express.static(path.join(__dirname, "public", "processed"))
);

// Routes
app.use("/api/images", imageRoutes);

// Health check
app.get("/health", (req, res) => {
  res.json({
    status: "OK",
    service: "Pixee AI Backend",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    features: [
      "Background Remover",
      "AI Enhancer",
      "Magic Eraser",
      "Avatar Creator",
      "Text to Image",
      "Upscale",
      "Style Transfer",
      "Mockup",
    ],
  });
});

// 404 Handler
app.use((req, res) => {
  res.status(404).json({
    error: "Route not found",
    path: req.originalUrl,
    available_endpoints: [
      "GET /health",
      "GET /api/images/operations",
      "GET /api/images/styles",
      "POST /api/images/remove-background",
      "POST /api/images/enhance",
      "POST /api/images/magic-eraser",
      "POST /api/images/create-avatar",
      "POST /api/images/text-to-image",
      "POST /api/images/upscale",
      "POST /api/images/style-transfer",
      "POST /api/images/create-mockup",
    ],
  });
});

// Error Handler
app.use((err, req, res, next) => {
  console.error(`[Server] Error: ${err.stack || err.message}`);
  if (err.code === "LIMIT_FILE_SIZE")
    return res.status(413).json({ error: "File too large (max 10MB)" });
  if (err.message?.startsWith("CORS"))
    return res.status(403).json({ error: err.message });
  res
    .status(500)
    .json({
      error: "Internal server error",
      message: NODE_ENV === "production" ? undefined : err.message,
    });
});

// Start server
const server = app.listen(PORT, HOST, () => {
  console.log(
    `[Server] Pixee AI Backend running on ${HOST}:${PORT} [${NODE_ENV}]`
  );
  console.log(
    `[Server] Time: ${new Date().toLocaleString("en-US", {
      timeZone: "Africa/Nairobi",
    })}`
  );
  console.log(
    "[Server] Features: Background Remover, AI Enhancer, Magic Eraser, Avatar Creator, Text-to-Image, Upscale, Style Transfer, Mockups"
  );
  scheduleCleanup();
});

// Graceful shutdown
const shutdown = (signal) => {
  console.log(`[Server] Received ${signal}, shutting down...`);
  server.close((err) => {
    if (err) {
      console.error(`[Server] Close error: ${err.message}`);
      process.exit(1);
    }
    console.log("[Server] Server stopped");
    process.exit(0);
  });
  setTimeout(() => {
    console.error("[Server] Forced shutdown after 30s");
    process.exit(1);
  }, 30000);
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

module.exports = app;
