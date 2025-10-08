const express = require("express");
const upload = require("../middleware/upload");
const { trackFileForCleanup } = require("../middleware/cleanup");
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

// POST routes
router.post(
  "/remove-background",
  upload.single("image"),
  (req, res, next) => {
    if (req.file) trackFileForCleanup(req.file.path)(req, res, next);
    else next();
  },
  imageController.removeBackground
);

router.post(
  "/enhance",
  upload.single("image"),
  (req, res, next) => {
    if (req.file) trackFileForCleanup(req.file.path)(req, res, next);
    else next();
  },
  imageController.enhanceImage
);

router.post(
  "/magic-eraser",
  upload.single("image"),
  (req, res, next) => {
    if (req.file) trackFileForCleanup(req.file.path)(req, res, next);
    else next();
  },
  imageController.magicEraser
);

router.post(
  "/create-avatar",
  upload.single("image"),
  (req, res, next) => {
    if (req.file) trackFileForCleanup(req.file.path)(req, res, next);
    else next();
  },
  imageController.createAvatar
);

router.post("/text-to-image", imageController.textToImage);

router.post(
  "/upscale",
  upload.single("image"),
  (req, res, next) => {
    if (req.file) trackFileForCleanup(req.file.path)(req, res, next);
    else next();
  },
  imageController.upscaleImage
);

router.post(
  "/style-transfer",
  upload.single("image"),
  (req, res, next) => {
    if (req.file) trackFileForCleanup(req.file.path)(req, res, next);
    else next();
  },
  imageController.styleTransfer
);

router.post(
  "/create-mockup",
  upload.single("image"),
  (req, res, next) => {
    if (req.file) trackFileForCleanup(req.file.path)(req, res, next);
    else next();
  },
  imageController.createMockup
);

module.exports = router;
