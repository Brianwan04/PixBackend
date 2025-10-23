const multer = require("multer");
const path = require("path");
const fs = require("fs").promises;

// Define upload directory
const UPLOAD_DIR = path.join(__dirname, "../../temp/uploads");

// Initialize directory on module load
const initializeUploadDir = async () => {
  try {
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
    console.log("[Upload] Directory initialized: ", UPLOAD_DIR);
  } catch (error) {
    console.error("[Upload] Failed to initialize directory: ", error.message);
  }
};
initializeUploadDir();

// Storage configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${uniqueSuffix}${path.extname(file.originalname).toLowerCase()}`);
  },
});

// File filter for images
const fileFilter = (req, file, cb) => {
  const validTypes = ["image/jpeg", "image/png", "image/webp"];
  if (validTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error("Only JPEG, PNG, and WebP images are allowed"), false);
  }
};

// ✅ FLEXIBLE UPLOAD METHODS
const createUpload = () => multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
});

// Export flexible methods:
module.exports = {
  // ✅ SINGLE IMAGE (for existing routes: background_remover, enhance, etc.)
  single: (fieldName = 'image') => createUpload().single(fieldName),
  
  // ✅ MULTIPLE IMAGES (for avatar-creator, ai-art)
  array: (fieldName, maxCount = 10) => createUpload().array(fieldName, maxCount),
  
  // ✅ BACKWARD COMPATIBLE (your existing usage)
  // upload.single('image') ✅ WORKS
  // upload.array('images', 4) ✅ WORKS
};

// Export original upload for backward compatibility
module.exports.default = createUpload();