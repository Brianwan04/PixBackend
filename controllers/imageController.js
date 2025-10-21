// controllers/imageController.js
const axios = require("axios");
const fs = require("fs").promises;
const path = require("path");
const { models } = require("../utils/replicateModels");
const { sampleStyles } = require("../config/styles");
require("dotenv").config();

let fetchFn;
if (typeof globalThis.fetch === "function") {
  fetchFn = globalThis.fetch.bind(globalThis);
} else {
  // dynamic import fallback for node-fetch (v3 is ESM)
  fetchFn = (...args) => import("node-fetch").then((m) => m.default(...args));
}

class ImageController {
  constructor() {
    this.token = process.env.REPLICATE_API_TOKEN;
    if (!this.token) {
      console.warn(
        "Warning: REPLICATE_API_TOKEN is not set. Replicate requests will fail until you set it."
      );
    }
    this.versionCache = {};
  }

  extractPinnedVersion = (modelId) => {
    if (!modelId) return null;
    const parts = modelId.split(":");
    return parts.length === 2 ? parts[1] : null;
  };

  resolveVersionId = async (modelId) => {
    if (this.versionCache[modelId]) return this.versionCache[modelId];
    const pinned = this.extractPinnedVersion(modelId);
    if (pinned) {
      this.versionCache[modelId] = pinned;
      return pinned;
    }

    const encoded = encodeURIComponent(modelId);
    const url = `https://api.replicate.com/v1/models/${encoded}/versions`;
    const res = await fetchFn(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = json?.error?.message || json?.detail || JSON.stringify(json);
      throw new Error(`Failed to list versions for ${modelId}: ${msg}`);
    }

    let versionId = Array.isArray(json?.versions) && json.versions.length > 0 ? json.versions[0].id : json[0]?.id || json[0];
    if (!versionId) throw new Error(`No versions returned for model ${modelId}`);
    this.versionCache[modelId] = versionId;
    return versionId;
  };

  createReplicatePrediction = async (versionId, input = {}, waitSeconds = 60) => {
    const url = "https://api.replicate.com/v1/predictions";
    const res = await fetchFn(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json", Prefer: `wait=${waitSeconds}` },
      body: JSON.stringify({ version: versionId, input }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = json?.error?.message || json?.detail || JSON.stringify(json);
      const err = new Error(`Replicate API error ${res.status}: ${msg}`);
      err.response = json;
      throw err;
    }
    return json;
  };

  getOutputUrl = (output) => {
    if (Array.isArray(output) && output.length > 0) return output[0].url || output[0];
    if (typeof output === "string") return output;
    if (output?.url) return output.url;
    throw new Error("Invalid output format from Replicate");
  };

  imageToBase64 = async (filePath) => {
    try {
      await fs.access(filePath);
      const buffer = await fs.readFile(filePath);
      return buffer.toString("base64");
    } catch (err) {
      throw new Error(`Failed to read image: ${err.message}`);
    }
  };

  saveProcessedImage = async (imageUrl, prefix = "processed") => {
    try {
      const response = await axios.get(imageUrl, { responseType: "arraybuffer", timeout: 30000 });
      const filename = `${prefix}-${Date.now()}.png`;
      const dir = path.join(__dirname, "../public/processed");
      await fs.mkdir(dir, { recursive: true });
      const filePath = path.join(dir, filename);
      await fs.writeFile(filePath, response.data);
      return { filename, path: filePath, url: `/processed/${filename}` };
    } catch (err) {
      throw new Error(`Failed to save image: ${err.message}`);
    }
  };

  runModel = async (modelEntry, input = {}) => {
    const modelId = modelEntry?.id;
    if (!modelId) throw new Error("Model id missing");
    const pinned = this.extractPinnedVersion(modelId);
    const versionId = pinned || await this.resolveVersionId(modelId);
    return this.createReplicatePrediction(versionId, input);
  };

  cleanupOnError = async (file) => {
    if (file?.path) {
      try { await fs.unlink(file.path); } catch (err) { console.error(`[Cleanup] Failed: ${err.message}`); }
    }
  };

  // ====== Model Functions ======
  removeBackground = this._processImage.bind(this, models.backgroundRemover, "no-bg", "background_remover", { format: "png" });
  enhanceImage = this._processImage.bind(this, models.aiEnhancer, "enhanced", "enhancer", { scale: 2 });
  magicEraser = this._processImage.bind(this, models.magicEraser, "erased", "magic_eraser", { prompt: "remove object" });
  upscaleImage = this._processImage.bind(this, models.imageUpscale, "upscaled", "upscale", { scale: 2, key: "img" });
  styleTransfer = this._processImage.bind(this, models.styleTransfer, "styled", "style_transfer", { prompt: "artistic style" });
  createMockup = this._processImage.bind(this, models.mockupGenerator, "mockup", "mockup", { bg_prompt: "professional" });

  textToImage = async (req, res) => {
    try {
      const { prompt, width = 1024, height = 1024, negative_prompt = "low quality" } = req.body;
      if (!prompt) return res.status(400).json({ error: "Prompt required" });
      const input = { prompt, width, height, negative_prompt, num_outputs: 1 };
      const prediction = await this.runModel(models.textToImage, input);
      const saved = await this.saveProcessedImage(this.getOutputUrl(prediction.output), "text-to-image");
      if (req.filesToCleanup) req.filesToCleanup.push(saved.path);
      res.json({ success: true, message: "Image generated", downloadUrl: saved.url, operation: "text_to_image", prompt });
    } catch (err) {
      console.error("[Text to Image] Error:", err.response ?? err.message);
      res.status(500).json({ error: "Image generation failed", message: err.response?.detail || err.message });
    }
  };

  getStyles = async (req, res) => {
    try { res.json({ success: true, styles: sampleStyles || { default: { name: "Default", prompt: "artistic" } } }); }
    catch (err) { res.status(500).json({ error: "Failed to fetch styles", message: err.message }); }
  };

  healthCheck = async (req, res) => {
    try {
      const url = "https://api.replicate.com/v1/models/stability-ai/stable-diffusion";
      const response = await fetchFn(url, { method: "GET", headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" } });
      if (!response.ok) throw new Error(JSON.stringify(await response.json().catch(() => ({}))));
      res.json({ status: "healthy", service: "Replicate API", timestamp: new Date().toISOString() });
    } catch (err) {
      res.status(503).json({ status: "unhealthy", service: "Replicate API", error: err.message });
    }
  };

  // ===== Helper to process any image-based model =====
  _processImage = async (modelEntry, prefix, operation, extraInput = {}, req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No image provided" });
      const base64 = await this.imageToBase64(req.file.path);
      const key = extraInput.key || "image";
      const input = { ...extraInput, [key]: `data:${req.file.mimetype};base64,${base64}` };
      const prediction = await this.runModel(modelEntry, input);
      const saved = await this.saveProcessedImage(this.getOutputUrl(prediction.output), prefix);
      if (req.filesToCleanup) req.filesToCleanup.push(saved.path);
      res.json({ success: true, message: `${operation} completed`, downloadUrl: saved.url, operation });
    } catch (err) {
      console.error(`[${operation}] Error:`, err.response ?? err.message);
      await this.cleanupOnError(req.file);
      res.status(500).json({ error: `${operation} failed`, message: err.response?.detail || err.message });
    }
  };
}

module.exports = new ImageController();
