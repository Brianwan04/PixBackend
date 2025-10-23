// routes/imageRoutes.js  (Option A - quick fix: use raw upload.single)
const express = require("express");
const upload = require("../middleware/upload"); // keep the existing multer instance export
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
  "/ai-art",
  upload.any(), // temporary for debugging
  (req, res, next) => {
    console.log('=== /ai-art incoming ===');
    console.log('content-type:', req.headers['content-type']);
    console.log('body keys:', Object.keys(req.body || {}));
    console.log('files:', (req.files || []).map(f => ({ fieldname: f.fieldname, originalname: f.originalname, mimetype: f.mimetype, path: f.path })));
    next();
  },
  registerFilesForCleanupIfPresent,
  imageController.aiArt,
  cleanupTrackedFiles
);

router.post(
  "/avatar-creator",
  upload.any(), // temporary for debugging
  (req, res, next) => {
    console.log('=== /avatar-creator incoming ===');
    console.log('content-type:', req.headers['content-type']);
    console.log('body keys:', Object.keys(req.body || {}));
    console.log('files:', (req.files || []).map(f => ({ fieldname: f.fieldname, originalname: f.originalname, mimetype: f.mimetype, path: f.path })));
    next();
  },
  registerFilesForCleanupIfPresent,
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
