const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;

// Define upload directory and ensure it exists
const UPLOAD_DIR = path.join(__dirname, '../../temp/uploads');
const initializeUploadDir = async () => {
  try {
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
    console.log(`Upload directory initialized at: ${UPLOAD_DIR}`);
  } catch (error) {
    console.error(`Failed to initialize upload directory: ${error.message}`);
  }
};
initializeUploadDir();

// Configure storage with unique filenames
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${uniqueSuffix}${path.extname(file.originalname).toLowerCase()}`);
  }
});

// File filter to accept only images
const fileFilter = (req, file, cb) => {
  const allowedMimes = ['image/jpeg', 'image/png', 'image/webp'];
  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Only JPEG, PNG, and WebP image files are allowed!'), false);
  }
};

// Multer configuration with limits
const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
});

module.exports = upload;