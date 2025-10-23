const multer = require("multer");
const path = require("path");
const fs = require("fs").promises;

const UPLOAD_DIR = path.join(__dirname, "../../temp/uploads");

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

const fileFilter = (req, file, cb) => {
  const validTypes = ["image/jpeg", "image/png", "image/webp"];
  if (validTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error("Only JPEG, PNG, and WebP images are allowed"), false);
  }
};

// ✅ FLEXIBLE UPLOAD - THE KEY FIX
const createUpload = () => multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 },
});

// ✅ EXPORT METHODS THAT WORK FOR ALL ROUTES
module.exports = {
  single: (fieldName = 'image') => createUpload().single(fieldName),
  array: (fieldName, maxCount = 10) => createUpload().array(fieldName, maxCount),
  any: () => createUpload().any()
};