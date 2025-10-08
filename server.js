// server.js
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const imageRoutes = require('./routes/imageRoutes');
const { scheduleCleanup } = require('./utils/fileCleanup');

const app = express();

// ---------- ENV & defaults ----------
const HOST = process.env.HOST || '127.0.0.1';     // bind to localhost behind nginx
const PORT = Number(process.env.PORT || 5000);
const TRUST_PROXY = process.env.TRUST_PROXY === 'true';
const NODE_ENV = process.env.NODE_ENV || 'development';

// ---------- trust proxy (for correct req.ip and X-Forwarded-* headers) ----------
if (TRUST_PROXY) {
  // trust first proxy (nginx)
  app.set('trust proxy', 1);
}

// Create necessary directories (safe-guard)
const dirs = ['temp/uploads', 'public/processed'];
dirs.forEach(dir => {
  const full = path.join(__dirname, dir);
  if (!fs.existsSync(full)) {
    fs.mkdirSync(full, { recursive: true });
    console.log(`Created directory: ${full}`);
  }
});

// Security middleware
app.use(helmet());

// ---------- CORS ----------
const defaultOrigins = [
  'http://localhost:5000',
  'http://localhost:5001',
  'https://pixeeaibackend.depaymprotocol.com'
];
const corsOrigins = (process.env.CORS_ORIGINS || defaultOrigins.join(','))
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

app.use(cors({
  origin: function(origin, callback) {
    // allow requests with no origin (mobile apps, curl, Postman)
    if (!origin) return callback(null, true);
    if (corsOrigins.indexOf(origin) !== -1) {
      return callback(null, true);
    } else {
      return callback(new Error('CORS policy: origin not allowed'), false);
    }
  },
  credentials: true
}));

// Rate limiting - configurable via env
const limiter = rateLimit({
  windowMs: Number(process.env.RATE_WINDOW_MS) || 15 * 60 * 1000,
  max: Number(process.env.RATE_MAX) || 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many requests from this IP, please try again later.'
  }
});
app.use('/api/images', limiter);

// Logging
if (NODE_ENV === 'production') {
  app.use(morgan('combined'));
} else {
  app.use(morgan('dev'));
}

// Body parsing middleware with larger limits for images
app.use(express.json({ limit: process.env.BODY_LIMIT || '50mb' }));
app.use(express.urlencoded({ extended: true, limit: process.env.BODY_LIMIT || '50mb' }));

// Static files - serve processed images
app.use('/processed', express.static(path.join(__dirname, 'public/processed')));

// Routes
app.use('/api/images', imageRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    service: 'Pixee AI Backend',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    features: [
      'Background Remover',
      'AI Enhancer',
      'Magic Eraser',
      'Avatar Creator',
      'Text to Image',
      'Image Upscale',
      'Style Transfer',
      'Mockup Generator'
    ]
  });
});

// 404 handler — Express 5 compatible
app.use((req, res) => {
  res.status(404).json({
    error: 'Route not found',
    path: req.originalUrl,
    available_endpoints: [
      'GET /health',
      'GET /api/images/operations',
      'GET /api/images/styles',
      'POST /api/images/remove-background',
      'POST /api/images/enhance',
      'POST /api/images/magic-eraser',
      'POST /api/images/create-avatar',
      'POST /api/images/text-to-image',
      'POST /api/images/upscale',
      'POST /api/images/style-transfer',
      'POST /api/images/create-mockup'
    ]
  });
});

// Global error handler
app.use((error, req, res, next) => {
  console.error('Global error handler:', error && error.stack ? error.stack : error);

  if (error && error.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      error: 'File too large. Maximum size is set by server.'
    });
  }

  // CORS error handling
  if (error && error.message && error.message.startsWith('CORS policy')) {
    return res.status(403).json({ error: error.message });
  }

  res.status(500).json({
    error: 'Internal server error',
    message: NODE_ENV === 'production' ? 'Something went wrong!' : (error && error.message)
  });
});

// Start server and graceful shutdown
const server = app.listen(PORT, HOST, () => {
  console.log(`🚀 Pixee AI Backend running on ${HOST}:${PORT}`);
  console.log(`📍 Environment: ${NODE_ENV}`);
  console.log(`✨ Features: Background Remover, AI Enhancer, Magic Eraser, Avatar Creator, Text-to-Image, Upscale, Style Transfer, Mockups`);

  // Start scheduled cleanup (from utils/fileCleanup)
  if (typeof scheduleCleanup === 'function') {
    scheduleCleanup();
  } else {
    console.warn('scheduleCleanup is not a function - check utils/fileCleanup export');
  }
});

function shutdown(signal) {
  console.log(`Received ${signal}. Closing server...`);
  // stop accepting new connections
  server.close(err => {
    if (err) {
      console.error('Error while closing server', err);
      process.exit(1);
    }
    console.log('HTTP server closed.');
    // allow any async cleanup to finish before exiting
    process.exit(0);
  });

  // force exit after 30s
  setTimeout(() => {
    console.warn('Forcing shutdown after timeout.');
    process.exit(1);
  }, 30_000);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

module.exports = app;
