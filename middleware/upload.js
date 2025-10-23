const multer = require("multer");
const path = require("path");
const fs = require("fs").promises;

const UPLOAD_DIR = path.join(__dirname, "../../temp/uploads");

// Initialize upload directory
const initializeUploadDir = async () => {
  try {
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
    console.log("[Upload] Directory initialized:", UPLOAD_DIR);
  } catch (error) {
    console.error("[Upload] Failed to initialize directory:", error.message);
  }
};
initializeUploadDir();

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${uniqueSuffix}${path.extname(file.originalname).toLowerCase()}`);
  },
});

// Multer configuration to accept multiple 'images' fields
const upload = multer({
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB
    files: 4, // Allow up to 4 files
  },
});

module.exports = upload;