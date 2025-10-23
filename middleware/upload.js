const multer = require("multer");
const path = require("path");
const fs = require("fs").promises;

const UPLOAD_DIR = path.join(__dirname, "../../temp/uploads");

// Create upload directory
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

// ✅ NO FILE FILTER = NO "Unexpected field" EVER
const upload = multer({ 
  storage,
  limits: { 
    fileSize: 50 * 1024 * 1024,  // 50MB
    files: 10
  }
  // ✅ NO fileFilter property = accepts ANY field name
});

module.exports = upload;
