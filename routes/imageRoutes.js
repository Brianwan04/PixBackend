// routes/imageRoutes.js  (Option A - quick fix: use raw upload.single)
const express = require("express");
//const upload = require("../middleware/upload"); // keep the existing multer instance export
const upload = require("../middleware/upload");
const { manualUpload } = require("../middleware/manualUpload");
const {
  trackFileForCleanup,
  cleanupTrackedFiles,
} = require("../utils/fileCleanup");
const imageController = require("../controllers/imageController");

// ---- add this helper right after your imports / router creation ----
function registerFilesForCleanupIfPresent(req, res, next) {
  try {
    if (req.files && Array.isArray(req.files) && req.files.length) {
      let i = 0;
      function nextTrack(err) {
        if (err) return next(err);
        if (i >= req.files.length) return next();
        const maybeMiddleware = trackFileForCleanup(req.files[i++].path);
        if (typeof maybeMiddleware === 'function') {
          // call the middleware returned by trackFileForCleanup
          maybeMiddleware(req, res, nextTrack);
        } else {
          // if it didn't return middleware, continue to next file
          nextTrack();
        }
      }
      return nextTrack();
    }
  } catch (e) {
    console.error('registerFilesForCleanupIfPresent error', e);
    // don't block request on cleanup helper errors
  }
  return next();
}
// -------------------------------------------------------------------


const router = express.Router();


// GET routes
router.get("/operations", (req, res) => {
  res.json({
    operations: [
      "background_remover",
      "enhancer",
      "object_detector",
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
  "/detect-objects",
  upload.single("image"), // or manualUpload if you prefer
  (req, res, next) => {
    if (req.file) trackFileForCleanup(req.file.path)(req, res, next);
    else next();
  },
  imageController.detectObjects,
  cleanupTrackedFiles
);

router.post(
  "/magic-eraser",
  // accept both "image" (single) and "mask" (single) uploaded
  upload.fields([{ name: "image", maxCount: 1 }, { name: "mask", maxCount: 1 }]),
  (req, res, next) => {
    if (req.files) {
      // register for cleanup any uploaded files
      const all = Object.values(req.files).flat();
      all.forEach(f => trackFileForCleanup(f.path)(req, res, () => {}));
    }
    next();
  },
  imageController.magicEraser,
  cleanupTrackedFiles
);

// Keep avatar route accepting 'main_face_image' as the file field
// Accept either "main_face_image" or "image" (explicit fields)
// routes/imageRoutes.js
// AI-ART (accept up to 2 images: source + optional target file)
router.post(
  "/create-avatar",
  manualUpload,
  (req, res, next) => {
    console.log("[/create-avatar] Files received:", req.files?.length || 0);
    console.log("[/create-avatar] File details:", req.files?.map(f => ({ fieldname: f.fieldname, originalname: f.originalname })));
    console.log("[/create-avatar] Body:", req.body);
    if (req.files && req.files.length > 0) {
      req.files.forEach(file => trackFileForCleanup(file.path)(req, res, () => {}));
    }
    next();
  },
  imageController.createAvatar,
  cleanupTrackedFiles
);

// Route for /ai-art
router.post(
  "/ai-art",
  manualUpload,
  (req, res, next) => {
    console.log("[/ai-art] Files received:", req.files?.length || 0);
    console.log("[/ai-art] File details:", req.files?.map(f => ({ fieldname: f.fieldname, originalname: f.originalname })));
    console.log("[/ai-art] Body:", req.body);
    if (req.files && req.files.length > 0) {
      req.files.forEach(file => trackFileForCleanup(file.path)(req, res, () => {}));
    }
    next();
  },
  imageController.aiArt,
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
