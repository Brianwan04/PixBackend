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
router.post(
  "/create-avatar",
  upload.fields([
    { name: "main_face_image", maxCount: 1 },
    { name: "image", maxCount: 1 }
  ]),
  (req, res, next) => {
    // find which file arrived and track it
    const f =
      (req.files && req.files.main_face_image && req.files.main_face_image[0]) ||
      (req.files && req.files.image && req.files.image[0]);

    if (f) {
      trackFileForCleanup(f.path)(req, res, next);
    } else next();
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
