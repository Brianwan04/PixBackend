// routes/imageRoutes.js  (Option A - quick fix: use raw upload.single)
const express = require("express");
const upload = require("../middleware/upload"); // keep the existing multer instance export
const {
  trackFileForCleanup,
  cleanupTrackedFiles,
} = require("../utils/fileCleanup");
const imageController = require("../controllers/imageController");

const router = express.Router();


// GET routes
router.get("/operations", (req, res) => {
  res.json({
    operations: [
      "background_remover",
      "enhancer",
      "magic_eraser",
      "avatar_creator",
      "text_to_image",
      "upscale",
      "style_transfer",
      "mockup",
    ],
  });
});

router.get("/styles", imageController.getStyles);
router.get("/health", imageController.healthCheck);

// POST routes with cleanup middleware
router.post(
  "/remove-background",
  upload.single("image"),
  (req, res, next) => {
    if (req.file) trackFileForCleanup(req.file.path)(req, res, next);
    else next();
  },
  imageController.removeBackground,
  cleanupTrackedFiles
);

router.post(
  "/enhance",
  upload.single("image"),
  (req, res, next) => {
    if (req.file) trackFileForCleanup(req.file.path)(req, res, next);
    else next();
  },
  imageController.enhanceImage,
  cleanupTrackedFiles
);

router.post(
  "/ai-art",
  upload.array('images', 2),  // Accept up to 2 images
  (req, res, next) => {
    if (req.files && req.files.length > 0) {
      req.files.forEach(file => trackFileForCleanup(file.path)(req, res, next));
    } else {
      next();
    }
  },
  imageController.aiArt,
  cleanupTrackedFiles
);

router.post(
  "/magic-eraser",
  upload.single("image"),
  (req, res, next) => {
    if (req.file) trackFileForCleanup(req.file.path)(req, res, next);
    else next();
  },
  imageController.magicEraser,
  cleanupTrackedFiles
);

// Keep avatar route accepting 'main_face_image' as the file field
// Accept either "main_face_image" or "image" (explicit fields)
// routes/imageRoutes.js
router.post(
  "/avatar-creator",
  upload.array('images', 4),  // Main + up to 3 auxiliary images
  (req, res, next) => {
    if (req.files && req.files.length > 0) {
      // register each file for cleanup by calling the middleware returned by trackFileForCleanup
      let i = 0;
      const files = req.files;
      function nextTrack(err) {
        if (err) return next(err);
        if (i >= files.length) return next();
        const maybeMiddleware = trackFileForCleanup(files[i++].path);
        if (typeof maybeMiddleware === 'function') {
          maybeMiddleware(req, res, nextTrack);
        } else {
          nextTrack();
        }
      }
      return nextTrack();
    } else {
      next();
    }
  },
  imageController.createAvatar,
  cleanupTrackedFiles
);


router.post("/text-to-image", imageController.textToImage, cleanupTrackedFiles);

router.post(
  "/upscale",
  upload.single("image"),
  (req, res, next) => {
    if (req.file) trackFileForCleanup(req.file.path)(req, res, next);
    else next();
  },
  imageController.upscaleImage,
  cleanupTrackedFiles
);

router.post(
  "/style-transfer",
  upload.single("image"),
  (req, res, next) => {
    if (req.file) trackFileForCleanup(req.file.path)(req, res, next);
    else next();
  },
  imageController.styleTransfer,
  cleanupTrackedFiles
);

router.post(
  "/create-mockup",
  upload.single("image"),
  (req, res, next) => {
    if (req.file) trackFileForCleanup(req.file.path)(req, res, next);
    else next();
  },
  imageController.createMockup,
  cleanupTrackedFiles
);

module.exports = router;
