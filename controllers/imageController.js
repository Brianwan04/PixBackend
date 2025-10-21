// controllers/imageController.js
const axios = require("axios");
const fs = require("fs").promises;
const path = require("path");
const { models } = require("../utils/replicateModels");
const { sampleStyles } = require("../config/styles");
require("dotenv").config();

// controllers/imageController.js
const FormData = require("form-data");
const fsExtra = require("fs"); // node fs for createReadStream

/*uploadToReplicate = async (filePath) => {
  const form = new FormData();
  form.append("file", fsExtra.createReadStream(filePath));

  const res = await fetchFn("https://api.replicate.com/v1/upload", {
    method: "POST",
    headers: { Authorization: `Token ${this.token}` },
    body: form,
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.url) {
    throw new Error("Failed to upload file to Replicate: " + JSON.stringify(json));
  }

  return json.url; // publicly accessible URL
};
*/

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
    this.versionCache = {}; // cache model slug -> version id
  }

  uploadToReplicate = async (filePath) => {
  const form = new FormData();
  form.append("file", fsExtra.createReadStream(filePath));

  const res = await fetchFn("https://api.replicate.com/v1/files", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${this.token}`,
    ...form.getHeaders(), // <-- crucial for multipart/form-data
  },
  body: form,
});


  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.url) {
    throw new Error("Failed to upload file to Replicate: " + JSON.stringify(json));
  }

  return json.url; // publicly accessible URL
};


  // Helper: Extract version if model id is pinned like "owner/model:version"
  extractPinnedVersion = (modelId) => {
    if (!modelId) return null;
    const parts = modelId.split(":");
    if (parts.length === 2) return parts[1];
    return null;
  };

  // Resolve a version id for a model id (either pinned or fetch first available version)
  resolveVersionId = async (modelId) => {
    if (this.versionCache[modelId]) return this.versionCache[modelId];

    // pinned version in model id (owner/model:version)
    const pinned = this.extractPinnedVersion(modelId);
    if (pinned) {
      this.versionCache[modelId] = pinned;
      return pinned;
    }

    // not pinned: modelId is like "bytedance/sdxl-lightning-4step"
    const encoded = encodeURIComponent(modelId);
    const url = `https://api.replicate.com/v1/models/${encoded}/versions`;

    const res = await fetchFn(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = json?.error?.message || json?.detail || JSON.stringify(json);
      throw new Error(`Failed to list versions for ${modelId}: ${msg}`);
    }

    // response shape: { versions: [ { id: "<version-id>", ... }, ... ] } or array depending on API
    let versionId = null;
    if (Array.isArray(json)) {
      versionId = json[0]?.id || json[0];
    } else if (Array.isArray(json?.versions) && json.versions.length > 0) {
      versionId = json.versions[0].id;
    } else if (json?.[0]?.id) {
      versionId = json[0].id;
    }

    if (!versionId) {
      throw new Error(
        `No available versions returned for model ${modelId}. Consider pinning a version id.`
      );
    }

    this.versionCache[modelId] = versionId;
    return versionId;
  };

  // Create a prediction via POST /v1/predictions and wait (Prefer: wait=60)
  createReplicatePrediction = async (versionId, input = {}, waitSeconds = 60) => {
  const url = "https://api.replicate.com/v1/predictions";
  const body = {
    version: versionId,
    input,
  };

  const res = await fetchFn(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${this.token}`,
      "Content-Type": "application/json",
      Prefer: `wait=${waitSeconds}`,
    },
    body: JSON.stringify(body),
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

// 2) Add this helper to parse mixed Replicate outputs and prefer images
getImageUrlFromPredictionOutput = (output) => {
  const imageRegex = /\.(png|jpe?g|webp|gif|bmp|svg)(\?.*)?$/i;

  const tryExtract = (item) => {
    if (!item) return null;
    if (typeof item === "object") {
      const candidate = item.url || item.artifact?.url || item.download_url || item.uri;
      if (candidate && (candidate.startsWith("data:image/") || imageRegex.test(candidate) || candidate.includes("replicate.delivery"))) return candidate;
      return null;
    }
    if (typeof item === "string") {
      if (item.startsWith("data:image/") || imageRegex.test(item)) return item;
      if (item.startsWith("https://replicate.delivery") || item.startsWith("https://") || item.startsWith("http://")) return item;
    }
    return null;
  };

  if (Array.isArray(output) && output.length > 0) {
    for (const item of output) {
      const v = tryExtract(item);
      if (v) return v;
    }
    // fallback: if first item is string return it
    const first = output[0];
    if (typeof first === "string") return first;
    if (first?.url) return first.url;
  }

  // single string or object
  const single = tryExtract(output);
  if (single) return single;

  throw new Error("No image URL found in prediction output");
};

  // Helper to get output URL (keeps your original logic)
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

  // Wrapper to run a model by its model entry from utils/replicateModels
  runModel = async (modelEntry, input = {}) => {
    // modelEntry.id might be "owner/model" or "owner/model:version"
    const modelId = modelEntry?.id;
    if (!modelId) throw new Error("Model id is missing");

    // If the id contains a colon, we treat the right side as a version id.
    const pinned = this.extractPinnedVersion(modelId);
    let versionId = pinned;
    if (!versionId) {
      // model slug (owner/model) -> get first available version
      versionId = await this.resolveVersionId(modelId);
    }

    // create prediction and return the prediction object
    const prediction = await this.createReplicatePrediction(versionId, input);
    return prediction;
  };

  // 1. AI Background Remover
  removeBackground = async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No image provided" });
      console.log(`[BG Remove] Processing: ${req.file.filename}`);

      const base64 = await this.imageToBase64(req.file.path);
      const input = {
        image: `data:${req.file.mimetype};base64,${base64}`,
        format: "png",
      };

      const prediction = await this.runModel(models.backgroundRemover, input);
      const saved = await this.saveProcessedImage(
        this.getOutputUrl(prediction.output),
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
      console.error("[BG Remove] Error:", error.response ?? error.message);
      await this.cleanupOnError(req.file);
      res
        .status(500)
        .json({ error: "Background removal failed", message: (error.response?.detail || error.message) });
    }
  };

  // 2. AI Enhancer
  enhanceImage = async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No image provided" });
      const base64 = await this.imageToBase64(req.file.path);
      const input = {
        image: `data:${req.file.mimetype};base64,${base64}`,
        scale: 2,
      };

      const prediction = await this.runModel(models.aiEnhancer, input);
      const saved = await this.saveProcessedImage(
        this.getOutputUrl(prediction.output),
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
      console.error("[Enhance] Error:", error.response ?? error.message);
      await this.cleanupOnError(req.file);
      res
        .status(500)
        .json({ error: "Enhancement failed", message: (error.response?.detail || error.message) });
    }
  };

  // 3. Magic Eraser
  magicEraser = async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No image provided" });
      const base64 = await this.imageToBase64(req.file.path);
      const input = {
        image: `data:${req.file.mimetype};base64,${base64}`,
        prompt: "remove object",
      };

      const prediction = await this.runModel(models.magicEraser, input);
      const saved = await this.saveProcessedImage(
        this.getOutputUrl(prediction.output),
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
      console.error("[Magic Eraser] Error:", error.response ?? error.message);
      await this.cleanupOnError(req.file);
      res
        .status(500)
        .json({ error: "Object removal failed", message: (error.response?.detail || error.message) });
    }
  };

  // 4. AI Avatar Creator
  createAvatar = async (req, res) => {
  // helper to pick file node from req.file or req.files
  const pickFileFromRequest = (r) => {
    if (r.file) return r.file;
    if (r.files) {
      const keys = ["main_face_image", "image", "file"];
      for (const k of keys) {
        if (Array.isArray(r.files[k]) && r.files[k][0]) return r.files[k][0];
      }
      const firstKey = Object.keys(r.files)[0];
      if (firstKey && Array.isArray(r.files[firstKey])) return r.files[firstKey][0];
    }
    return null;
  };

  try {
    // Accept either an uploaded file OR a remote 'main_face_image' URL in req.body
    const uploadedFile = pickFileFromRequest(req);
    const remoteFaceUrl = req.body?.main_face_image; // e.g., replicate.delivery url or other image url

    if (!uploadedFile && !remoteFaceUrl) {
      return res.status(400).json({ error: "No image provided (upload or main_face_image url required)" });
    }

    // Read style/options from request body, with sensible defaults
    const style = req.body?.style || req.body?.style_id || "fantasy";
    const cfg_scale = Number(req.body?.cfg_scale ?? 1.2);
    const num_steps = Number(req.body?.num_steps ?? 20);
    const image_width = Number(req.body?.image_width ?? 768);
    const image_height = Number(req.body?.image_height ?? 1024);
    const num_samples = Number(req.body?.num_samples ?? 1);
    const output_format = req.body?.output_format || "png";
    const identity_scale = Number(req.body?.identity_scale ?? 0.8);
    const mix_identities = req.body?.mix_identities === "true" || req.body?.mix_identities === true ? true : false;
    const negative_prompt = req.body?.negative_prompt || "low quality, bad anatomy, watermark";
    const generation_mode = req.body?.generation_mode || "fidelity";
    const output_quality = Number(req.body?.output_quality ?? 90);

    // If uploaded file exists, convert to base64 data URL. Otherwise pass the remote url through.
    let mainFaceInput;
if (uploadedFile) {
  mainFaceInput = await this.uploadToReplicate(uploadedFile.path); // <--- uploaded to get URL
} else {
  mainFaceInput = remoteFaceUrl;
}


    // Build input object modeled after the Replicate example you shared
    const input = {
      prompt: `Portrait of the provided face — ${style} style. High detail, clean background, sharp facial detail, professional lighting.`,
      cfg_scale,
      num_steps,
      image_width,
      image_height,
      num_samples,
      output_format,
      identity_scale,
      mix_identities,
      output_quality,
      generation_mode,
      main_face_image: mainFaceInput,
      negative_prompt,
    };

    // Run the model (models.avatarCreator should be defined in utils/replicateModels)
    const prediction = await this.runModel(models.avatarCreator, input);

    // Extract image URL robustly from the prediction.output
    const imageUrl = this.getImageUrlFromPredictionOutput(prediction.output);

    const saved = await this.saveProcessedImage(imageUrl, "avatar");
    if (req.filesToCleanup) req.filesToCleanup.push(saved.path);

    res.json({
      success: true,
      message: "Avatar created",
      downloadUrl: saved.url,
      operation: "avatar_creator",
    });
  } catch (error) {
    console.error("[Avatar] Error:", error.response ?? error.message);
    const file = (req.file) || (req.files && (req.files.main_face_image?.[0] || req.files.image?.[0] || req.files.file?.[0]));
    await this.cleanupOnError(file);
    res.status(500).json({ error: "Avatar creation failed", message: (error.response?.detail || error.message) });
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

      // Many users want to specifically control SDXL version — if you set env REPLICATE_SDXL_VERSION
      // and the textToImage model (in utils/replicateModels) is a slug (no pinned version),
      // resolveVersionId will use the first available version. You can also pin the version in utils/replicateModels.
      const input = { prompt, width, height, negative_prompt, num_outputs: 1 };
      const prediction = await this.runModel(models.textToImage, input);

      const saved = await this.saveProcessedImage(
        this.getOutputUrl(prediction.output),
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
      console.error("[Text to Image] Error:", error.response ?? error.message);
      res
        .status(500)
        .json({ error: "Image generation failed", message: (error.response?.detail || error.message) });
    }
  };

  // 6. Image Upscale
  upscaleImage = async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No image provided" });
      const base64 = await this.imageToBase64(req.file.path);
      const input = {
        image: `data:${req.file.mimetype};base64,${base64}`,
        scale: 2,
      };

      const prediction = await this.runModel(models.imageUpscale, input);
      const saved = await this.saveProcessedImage(
        this.getOutputUrl(prediction.output),
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
      console.error("[Upscale] Error:", error.response ?? error.message);
      await this.cleanupOnError(req.file);
      res.status(500).json({ error: "Upscale failed", message: (error.response?.detail || error.message) });
    }
  };

  // 7. Style Transfer
  styleTransfer = async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No image provided" });
      const base64 = await this.imageToBase64(req.file.path);
      const input = {
        image: `data:${req.file.mimetype};base64,${base64}`,
        prompt: "artistic style",
      };

      const prediction = await this.runModel(models.styleTransfer, input);
      const saved = await this.saveProcessedImage(
        this.getOutputUrl(prediction.output),
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
      console.error("[Style Transfer] Error:", error.response ?? error.message);
      await this.cleanupOnError(req.file);
      res
        .status(500)
        .json({ error: "Style transfer failed", message: (error.response?.detail || error.message) });
    }
  };

  // 8. Mockup Generator
  createMockup = async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No image provided" });
      const base64 = await this.imageToBase64(req.file.path);
      const input = {
        image: `data:${req.file.mimetype};base64,${base64}`,
        bg_prompt: "professional",
      };

      const prediction = await this.runModel(models.mockupGenerator, input);
      const saved = await this.saveProcessedImage(
        this.getOutputUrl(prediction.output),
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
      console.error("[Mockup] Error:", error.response ?? error.message);
      await this.cleanupOnError(req.file);
      res
        .status(500)
        .json({ error: "Mockup creation failed", message: (error.response?.detail || error.message) });
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

  // Health check - pings the models API
  healthCheck = async (req, res) => {
    try {
      const url = "https://api.replicate.com/v1/models/stability-ai/stable-diffusion";
      const response = await fetchFn(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
        },
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(JSON.stringify(body));
      }
      res.json({
        status: "healthy",
        service: "Replicate API",
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      res.status(503).json({
        status: "unhealthy",
        service: "Replicate API",
        error: error.message,
      });
    }
  };
}

module.exports = new ImageController();