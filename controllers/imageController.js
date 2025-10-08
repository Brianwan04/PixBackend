const axios = require("axios");
const fs = require("fs").promises;
const path = require("path");
const Replicate = require("replicate");
const { models } = require("../utils/replicateModels");
const { sampleStyles } = require("../config/styles");
require("dotenv").config();

class ImageController {
  constructor() {
    this.replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });
  }

  // Helper to get output URL
  getOutputUrl = (output) => {
    if (Array.isArray(output) && output.length > 0) {
      return output[0].url || output[0];
    } else if (typeof output === "string") {
      return output;
    } else if (output?.url) {
      return output.url;
    }
    throw new Error("Invalid output format from Replicate");
  };

  // Convert image to base64
  imageToBase64 = async (filePath) => {
    try {
      const dir = path.dirname(filePath);
      await fs.mkdir(dir, { recursive: true });
      if (
        !(await fs
          .access(filePath)
          .then(() => true)
          .catch(() => false))
      ) {
        throw new Error("File not found");
      }
      const buffer = await fs.readFile(filePath);
      return buffer.toString("base64");
    } catch (error) {
      throw new Error(`Failed to read image: ${error.message}`);
    }
  };

  // Save processed image
  saveProcessedImage = async (imageUrl, prefix = "processed") => {
    try {
      const response = await axios.get(imageUrl, {
        responseType: "arraybuffer",
        timeout: 30000,
      });
      const filename = `${prefix}-${Date.now()}.png`;
      const dir = path.join(__dirname, "../public/processed");
      await fs.mkdir(dir, { recursive: true });
      const filePath = path.join(dir, filename);
      await fs.writeFile(filePath, response.data);
      return { filename, path: filePath, url: `/processed/${filename}` };
    } catch (error) {
      throw new Error(`Failed to save image: ${error.message}`);
    }
  };

  // 1. AI Background Remover
  removeBackground = async (req, res) => {
    try {
      if (!req.file)
        return res.status(400).json({ error: "No image provided" });
      console.log(`[BG Remove] Processing: ${req.file.filename}`);
      const base64 = await this.imageToBase64(req.file.path);
      const output = await this.replicate.run(models.backgroundRemover.id, {
        input: {
          image: `data:${req.file.mimetype};base64,${base64}`,
          format: "png",
        },
      });
      const saved = await this.saveProcessedImage(
        this.getOutputUrl(output),
        "no-bg"
      );
      if (req.filesToCleanup) req.filesToCleanup.push(saved.path);
      res.json({
        success: true,
        message: "Background removed",
        downloadUrl: saved.url,
        operation: "background_remover",
      });
    } catch (error) {
      console.error("[BG Remove] Error:", error);
      await this.cleanupOnError(req.file);
      res
        .status(500)
        .json({ error: "Background removal failed", message: error.message });
    }
  };

  // 2. AI Enhancer
  enhanceImage = async (req, res) => {
    try {
      if (!req.file)
        return res.status(400).json({ error: "No image provided" });
      const base64 = await this.imageToBase64(req.file.path);
      const output = await this.replicate.run(models.aiEnhancer.id, {
        input: {
          image: `data:${req.file.mimetype};base64,${base64}`,
          scale: 2,
        },
      });
      const saved = await this.saveProcessedImage(
        this.getOutputUrl(output),
        "enhanced"
      );
      if (req.filesToCleanup) req.filesToCleanup.push(saved.path);
      res.json({
        success: true,
        message: "Image enhanced",
        downloadUrl: saved.url,
        operation: "enhancer",
      });
    } catch (error) {
      console.error("[Enhance] Error:", error);
      await this.cleanupOnError(req.file);
      res
        .status(500)
        .json({ error: "Enhancement failed", message: error.message });
    }
  };

  // 3. Magic Eraser
  magicEraser = async (req, res) => {
    try {
      if (!req.file)
        return res.status(400).json({ error: "No image provided" });
      const base64 = await this.imageToBase64(req.file.path);
      const output = await this.replicate.run(models.magicEraser.id, {
        input: {
          image: `data:${req.file.mimetype};base64,${base64}`,
          prompt: "remove object",
        },
      });
      const saved = await this.saveProcessedImage(
        this.getOutputUrl(output),
        "erased"
      );
      if (req.filesToCleanup) req.filesToCleanup.push(saved.path);
      res.json({
        success: true,
        message: "Object removed",
        downloadUrl: saved.url,
        operation: "magic_eraser",
      });
    } catch (error) {
      console.error("[Magic Eraser] Error:", error);
      await this.cleanupOnError(req.file);
      res
        .status(500)
        .json({ error: "Object removal failed", message: error.message });
    }
  };

  // 4. AI Avatar Creator
  createAvatar = async (req, res) => {
    try {
      if (!req.file)
        return res.status(400).json({ error: "No image provided" });
      const base64 = await this.imageToBase64(req.file.path);
      const output = await this.replicate.run(models.avatarCreator.id, {
        input: {
          image: `data:${req.file.mimetype};base64,${base64}`,
          prompt: "high quality avatar",
        },
      });
      const saved = await this.saveProcessedImage(
        this.getOutputUrl(output),
        "avatar"
      );
      if (req.filesToCleanup) req.filesToCleanup.push(saved.path);
      res.json({
        success: true,
        message: "Avatar created",
        downloadUrl: saved.url,
        operation: "avatar_creator",
      });
    } catch (error) {
      console.error("[Avatar] Error:", error);
      await this.cleanupOnError(req.file);
      res
        .status(500)
        .json({ error: "Avatar creation failed", message: error.message });
    }
  };

  // 5. Text to Image
  textToImage = async (req, res) => {
    try {
      const {
        prompt,
        width = 1024,
        height = 1024,
        negative_prompt = "low quality",
      } = req.body;
      if (!prompt) return res.status(400).json({ error: "Prompt required" });
      const output = await this.replicate.run(models.textToImage.id, {
        input: { prompt, width, height, negative_prompt, num_outputs: 1 },
      });
      const saved = await this.saveProcessedImage(
        this.getOutputUrl(output),
        "text-to-image"
      );
      if (req.filesToCleanup) req.filesToCleanup.push(saved.path);
      res.json({
        success: true,
        message: "Image generated",
        downloadUrl: saved.url,
        operation: "text_to_image",
        prompt,
      });
    } catch (error) {
      console.error("[Text to Image] Error:", error);
      res
        .status(500)
        .json({ error: "Image generation failed", message: error.message });
    }
  };

  // 6. Image Upscale
  upscaleImage = async (req, res) => {
    try {
      if (!req.file)
        return res.status(400).json({ error: "No image provided" });
      const base64 = await this.imageToBase64(req.file.path);
      const output = await this.replicate.run(models.imageUpscale.id, {
        input: {
          image: `data:${req.file.mimetype};base64,${base64}`,
          scale: 2,
        },
      });
      const saved = await this.saveProcessedImage(
        this.getOutputUrl(output),
        "upscaled"
      );
      if (req.filesToCleanup) req.filesToCleanup.push(saved.path);
      res.json({
        success: true,
        message: "Image upscaled",
        downloadUrl: saved.url,
        operation: "upscale",
      });
    } catch (error) {
      console.error("[Upscale] Error:", error);
      await this.cleanupOnError(req.file);
      res.status(500).json({ error: "Upscale failed", message: error.message });
    }
  };

  // 7. Style Transfer
  styleTransfer = async (req, res) => {
    try {
      if (!req.file)
        return res.status(400).json({ error: "No image provided" });
      const base64 = await this.imageToBase64(req.file.path);
      const output = await this.replicate.run(models.styleTransfer.id, {
        input: {
          image: `data:${req.file.mimetype};base64,${base64}`,
          prompt: "artistic style",
        },
      });
      const saved = await this.saveProcessedImage(
        this.getOutputUrl(output),
        "styled"
      );
      if (req.filesToCleanup) req.filesToCleanup.push(saved.path);
      res.json({
        success: true,
        message: "Style applied",
        downloadUrl: saved.url,
        operation: "style_transfer",
      });
    } catch (error) {
      console.error("[Style Transfer] Error:", error);
      await this.cleanupOnError(req.file);
      res
        .status(500)
        .json({ error: "Style transfer failed", message: error.message });
    }
  };

  // 8. Mockup Generator
  createMockup = async (req, res) => {
    try {
      if (!req.file)
        return res.status(400).json({ error: "No image provided" });
      const base64 = await this.imageToBase64(req.file.path);
      const output = await this.replicate.run(models.mockupGenerator.id, {
        input: {
          image: `data:${req.file.mimetype};base64,${base64}`,
          bg_prompt: "professional",
        },
      });
      const saved = await this.saveProcessedImage(
        this.getOutputUrl(output),
        "mockup"
      );
      if (req.filesToCleanup) req.filesToCleanup.push(saved.path);
      res.json({
        success: true,
        message: "Mockup created",
        downloadUrl: saved.url,
        operation: "mockup",
      });
    } catch (error) {
      console.error("[Mockup] Error:", error);
      await this.cleanupOnError(req.file);
      res
        .status(500)
        .json({ error: "Mockup creation failed", message: error.message });
    }
  };

  // Get available styles
  getStyles = async (req, res) => {
    try {
      res.json({
        success: true,
        styles: sampleStyles || {
          default: { name: "Default", prompt: "artistic" },
        },
      });
    } catch (error) {
      console.error("[Styles] Error:", error);
      res
        .status(500)
        .json({ error: "Failed to fetch styles", message: error.message });
    }
  };

  // Cleanup on error
  cleanupOnError = async (file) => {
    if (file?.path) {
      try {
        await fs.unlink(file.path);
        console.log(`[Cleanup] Removed ${file.path}`);
      } catch (error) {
        console.error(
          `[Cleanup] Failed to remove ${file.path}: ${error.message}`
        );
      }
    }
  };

  // Health check
  healthCheck = async (req, res) => {
    try {
      await this.replicate.models.get("stability-ai/stable-diffusion");
      res.json({
        status: "healthy",
        service: "Replicate API",
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      res
        .status(503)
        .json({
          status: "unhealthy",
          service: "Replicate API",
          error: error.message,
        });
    }
  };
}

module.exports = new ImageController();
