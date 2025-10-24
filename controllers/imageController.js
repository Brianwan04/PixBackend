// controllers/imageController.js
const axios = require("axios");
const fs = require("fs").promises;
const path = require("path");
const FormData = require("form-data");
const fsExtra = require("fs");
//const mime = require("mime"); // Explicit import
const mime = require("mime-types");
const { models } = require("../utils/replicateModels");
const { sampleStyles } = require("../config/styles");
require("dotenv").config();

//const mimeType = mime.lookup(filename) || "image/jpeg";



let fetchFn;
if (typeof globalThis.fetch === "function") {
  fetchFn = globalThis.fetch.bind(globalThis);
} else {
  fetchFn = (...args) => import("node-fetch").then((m) => m.default(...args));
}

class ImageController {
  constructor() {
    this.token = process.env.REPLICATE_API_TOKEN;
    if (!this.token) {
      console.warn("Warning: REPLICATE_API_TOKEN is not set.");
    }
    this.versionCache = {};
  }

  // paste this into controllers/imageController.js replacing existing uploadToReplicate
uploadToReplicate = async (filePath) => {
  const maxRetries = 2;
  const filename = path.basename(filePath);
  const mimeType = mime.lookup(filename) || 'image/jpeg';
  const url = 'https://api.replicate.com/v1/files';

  if (!this.token) {
    throw new Error('Replicate API token is not set');
  }

  // Sanity check file
  try {
    const stats = await fs.stat(filePath);
    if (!stats.isFile()) throw new Error(`Path is not a file: ${filePath}`);
    if (stats.size === 0) throw new Error(`File is empty: ${filePath}`);
    console.log(`[uploadToReplicate] File check passed: ${filePath}, Size: ${stats.size} bytes`);
  } catch (err) {
    throw new Error(`File not accessible: ${filePath} - ${err.message}`);
  }

  const attemptUpload = async (attempt = 0) => {
    // Use a stream (better for memory) but Buffer works too
    let stream;
    try {
      stream = fsExtra.createReadStream(filePath);
      // note: fsExtra here is node's fs (you imported as fsExtra = require('fs'))
    } catch (err) {
      throw new Error(`Failed to create read stream: ${err.message}`);
    }

    const form = new FormData();
    // Append as stream (recommended)
    form.append('file', stream, {
      filename,
      contentType: mimeType,
    });

    // Prepare headers using form-data helper (includes the correct boundary)
    const formHeaders = form.getHeaders(); // { 'content-type': 'multipart/form-data; boundary=----...' }

    // Try to get content-length (optional but useful)
    let contentLength = null;
    try {
      contentLength = await new Promise((resolve, reject) => {
        form.getLength((err, length) => {
          if (err) return reject(err);
          resolve(length);
        });
      });
      formHeaders['Content-Length'] = contentLength;
    } catch (err) {
      console.warn('[uploadToReplicate] Could not determine Content-Length:', err.message);
    }

    // Log safe debug info (do NOT attempt to iterate form internals)
    console.log('[uploadToReplicate] Prepared FormData for upload:', {
      filename,
      mimeType,
      estimatedSize: contentLength || 'unknown',
      headersPreview: formHeaders ? Object.keys(formHeaders) : null,
    });

    const headers = {
      Authorization: `Token ${this.token}`,
      ...formHeaders,
    };

    console.log(`[uploadToReplicate] Uploading ${filename} (attempt ${attempt + 1})`, {
      url,
      filename,
      mimeType,
    });

    try {
      const res = await axios.post(url, form, {
        headers,
        timeout: 120000,
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        validateStatus: null,
      });

      console.log(`[uploadToReplicate] Response status: ${res.status}, data:`, res.data);

      if (res.status >= 400) {
        const err = new Error(`Failed to upload: ${JSON.stringify(res.data)}`);
        err.status = res.status;
        err.response = res.data;
        throw err;
      }

      const publicUrl = res.data.urls?.get || res.data.url;
      if (!publicUrl) throw new Error('No public URL returned from Replicate upload');
      console.log(`[uploadToReplicate] Success: ${publicUrl}`);
      return publicUrl;
    } catch (err) {
      console.error(`[uploadToReplicate] Upload error (attempt ${attempt + 1}):`, {
        message: err.message,
        status: err.status,
        response: err.response,
      });
      if (attempt < maxRetries) {
        console.log(`[uploadToReplicate] Retrying upload (${attempt + 2})...`);
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
        return attemptUpload(attempt + 1);
      }
      console.warn(`[uploadToReplicate] Upload failed after ${maxRetries + 1} attempts, falling back to base64`);
      throw err;
    }
  };

  return attemptUpload(0);
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

  // Initial prediction request
  const res = await fetchFn(url, {
    method: "POST",
    headers: {
      Authorization: `Token ${this.token}`,
      "Content-Type": "application/json",
      Prefer: `wait=${waitSeconds}`, // Initial wait
    },
    body: JSON.stringify(body),
  });

  let json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json?.error?.message || json?.detail || JSON.stringify(json);
    const err = new Error(`Replicate API error ${res.status}: ${msg}`);
    err.response = json;
    throw err;
  }

  // If already succeeded, return immediately
  if (json.status === "succeeded") {
    return json;
  }

  // If not succeeded, poll until completion or timeout
  const pollUrl = json.urls?.get;
  if (!pollUrl) {
    throw new Error("No polling URL provided in prediction response");
  }

  const maxPollTime = 300000; // 5 minutes in milliseconds
  const startTime = Date.now();
  let delay = 1000; // Start with 1-second delay
  const maxDelay = 10000; // Max 10-second delay

  while (Date.now() - startTime < maxPollTime) {
    await new Promise((resolve) => setTimeout(resolve, delay)); // Wait before polling

    const pollRes = await fetchFn(pollUrl, {
      method: "GET",
      headers: {
        Authorization: `Token ${this.token}`,
        "Content-Type": "application/json",
      },
    });

    json = await pollRes.json().catch(() => ({}));
    if (!pollRes.ok) {
      const msg = json?.error?.message || json?.detail || JSON.stringify(json);
      const err = new Error(`Replicate poll error ${pollRes.status}: ${msg}`);
      err.response = json;
      throw err;
    }

    if (json.status === "succeeded" || json.status === "failed" || json.status === "canceled") {
      return json; // Return final prediction
    }

    // Exponential backoff: increase delay up to maxDelay
    delay = Math.min(delay * 2, maxDelay);
  }

  throw new Error("Prediction timed out after 5 minutes");
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
    console.log(`[saveProcessedImage] Downloading image from: ${imageUrl}`);
    const response = await axios.get(imageUrl, {
      responseType: "arraybuffer",
      timeout: 30000,
      validateStatus: (status) => status >= 200 && status < 300,
    });

    const contentType = response.headers["content-type"];
    const dataSize = response.data.length;
    console.log(`[saveProcessedImage] Content-Type: ${contentType}, Size: ${dataSize} bytes`);

    if (!contentType.startsWith("image/")) {
      console.error(`[saveProcessedImage] Invalid content type: ${contentType}`);
      console.error(`[saveProcessedImage] Response content: ${Buffer.from(response.data).toString('utf8')}`);
      throw new Error(`Invalid content type: ${contentType}`);
    }

    if (dataSize < 1000) {
      console.error(`[saveProcessedImage] Downloaded file too small: ${dataSize} bytes`);
      console.error(`[saveProcessedImage] Response content: ${Buffer.from(response.data).toString('utf8')}`);
      throw new Error("Downloaded file is too small, likely invalid");
    }

    const filename = `${prefix}-${Date.now()}.png`;
    const dir = path.join(__dirname, "../public/processed");
    await fs.mkdir(dir, { recursive: true });
    const filePath = path.join(dir, filename);
    await fs.writeFile(filePath, response.data);

    const fileStats = await fs.stat(filePath);
    console.log(`[saveProcessedImage] Saved file: ${filePath}, Size: ${fileStats.size} bytes`);

    const fileUrl = `/processed/${filename}`;
    console.log(`[saveProcessedImage] Generated URL: ${fileUrl}`);

    // Verify file accessibility
    // derive a base URL for verification — prefer env override, else try localhost with configured port
const baseForVerification = process.env.PUBLIC_BASE_URL || process.env.API_BASE_URL || `http://127.0.0.1:${process.env.PORT || 5000}`;
try {
  const verifyResponse = await axios.head(`${baseForVerification.replace(/\/$/, '')}${fileUrl}`, { timeout: 5000 });
  console.log(`[saveProcessedImage] Local file verification status: ${verifyResponse.status}`);
} catch (verifyErr) {
  console.warn(`[saveProcessedImage] Local file verification failed: ${verifyErr.message}`);
}


    return { filename, path: filePath, url: fileUrl };
  } catch (error) {
    console.error(`[saveProcessedImage] Failed: ${error.message}`, error);
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

createAvatar = async (req, res) => {
  try {
    // Validate input
    if (!req.files || req.files.length < 1) {
      return res.status(400).json({ error: "No main face image provided" });
    }

    // Log received files and body
    console.log("[Avatar Creator] Files:", req.files.map(f => ({ path: f.path, originalname: f.originalname })));
    console.log("[Avatar Creator] Body:", req.body);

    // Main face image (first file)
    const mainImagePath = req.files[0].path;
    console.log(`[Avatar Creator] Main image: ${mainImagePath}`);

    // Auxiliary images (up to 3)
    const auxiliaryImages = req.files.slice(1, 4).map((file, i) => {
      console.log(`[Avatar Creator] Auxiliary ${i + 1} image: ${file.path}`);
      return file.path;
    });

    // Get parameters
    const prompt = req.body?.prompt || "a portrait of a person";
    const cfg_scale = Number(req.body?.cfg_scale || 1.2);
    const num_steps = Number(req.body?.num_steps || 4);
    const num_samples = Number(req.body?.num_samples || 4);
    const image_width = Number(req.body?.image_width || 768);
    const image_height = Number(req.body?.image_height || 1024);
    const identity_scale = Number(req.body?.identity_scale || 0.8);
    const output_quality = Number(req.body?.output_quality || 80);
    const negative_prompt = req.body?.negative_prompt || "flaws in the eyes, flaws in the face, flaws, lowres, non-HDRi, low quality, worst quality, artifacts noise, text, watermark, glitch, deformed, mutated, ugly, disfigured, hands, low resolution, partially rendered objects, deformed or partially rendered eyes, deformed, deformed eyeballs, cross-eyed, blurry";

    // Upload main image to Replicate
    let mainImageUrl;
    try {
      console.log("[Avatar Creator] Uploading MAIN image");
      mainImageUrl = await this.uploadToReplicate(mainImagePath);
      console.log(`[Avatar Creator] MAIN uploaded: ${mainImageUrl}`);
    } catch (uploadErr) {
      console.error("[Avatar Creator] MAIN upload failed:", uploadErr.message);
      // in createAvatar catch fallback
      const base64 = await this.imageToBase64(mainImagePath);
      const mimeType =
        req.files[0]?.mimetype ||
        mime.lookup(req.files[0]?.originalname) ||
        "image/jpeg";
      mainImageUrl = `data:${mimeType};base64,${base64}`;

      console.log("[Avatar Creator] MAIN using base64");
    }

    // Upload auxiliary images (up to 3)
    const auxImageUrls = [];
    for (let i = 0; i < auxiliaryImages.length; i++) {
      try {
        console.log(`[Avatar Creator] Uploading auxiliary image ${i + 1}`);
        const url = await this.uploadToReplicate(auxiliaryImages[i]);
        auxImageUrls.push(url);
        console.log(`[Avatar Creator] Auxiliary ${i + 1} uploaded: ${url}`);
      } catch (uploadErr) {
        console.error(
          `[Avatar Creator] Auxiliary ${i + 1} upload failed:`,
          uploadErr.message
        );
        // in aux fallback loop
        const base64 = await this.imageToBase64(auxiliaryImages[i]);
        const mimeType =
          req.files[i + 1]?.mimetype ||
          mime.lookup(req.files[i + 1]?.originalname) ||
          "image/jpeg";
        auxImageUrls.push(`data:${mimeType};base64,${base64}`);

        console.log(`[Avatar Creator] Auxiliary ${i + 1} using base64`);
      }
    }

    // Build Replicate input
    const input = {
  prompt,
  cfg_scale,
  num_steps,
  image_width,
  num_samples,
  image_height,
  output_format: "webp",
  identity_scale,
  mix_identities: false,
  output_quality,
  generation_mode: "fidelity",
  main_face_image: mainImageUrl,
  negative_prompt,
};

// only include auxiliary fields if present (no nulls)
if (auxImageUrls[0]) input.auxiliary_face_image1 = auxImageUrls[0];
if (auxImageUrls[1]) input.auxiliary_face_image2 = auxImageUrls[1];
if (auxImageUrls[2]) input.auxiliary_face_image3 = auxImageUrls[2];


    console.log("[Avatar Creator] Replicate input ready:", {
      prompt,
      main_face_image: mainImageUrl.substring(0, 80) + "...",
      has_aux1: !!auxImageUrls[0],
      has_aux2: !!auxImageUrls[1],
      has_aux3: !!auxImageUrls[2],
      num_samples,
    });

    // Run prediction
    const prediction = await this.runModel(models.avatarCreator, input);
    console.log("[Avatar Creator] Prediction status:", prediction.status);
    console.log("[Avatar Creator] Raw prediction output:", JSON.stringify(prediction.output, null, 2));

    if (prediction.status !== "succeeded") {
      throw new Error(`Prediction failed: ${prediction.error || "Unknown error"}`);
    }

    // Extract image URL
    let firstImageUrl;
    try {
      firstImageUrl = this.getImageUrlFromPredictionOutput(prediction.output);
      console.log("[Avatar Creator] First result URL:", firstImageUrl);
    } catch (extractErr) {
      console.error("[Avatar Creator] Failed to extract image URL:", extractErr.message);
      throw new Error(`Failed to extract image URL: ${extractErr.message}`);
    }

    // Save and return
    const saved = await this.saveProcessedImage(firstImageUrl, "avatar-creator");
    if (req.filesToCleanup) {
      req.filesToCleanup.push(saved.path);
    }

    return res.json({
      success: true,
      message: "Avatar created successfully",
      downloadUrl: saved.url,
      operation: "avatar_creator",
      prediction_id: prediction?.id || null,
    });
  } catch (error) {
    console.error("[Avatar Creator] Error:", error.message);
    if (req.files) {
      req.files.forEach(file => this.cleanupOnError(file));
    }
    return res.status(500).json({
      error: "Avatar creation failed",
      message: error.message,
    });
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
    if (!req.file) {
      return res.status(400).json({ error: "No image provided" });
    }

    // Read file and build a data URI
    const mimeType = req.file.mimetype || "image/jpeg";
    const base64 = await this.imageToBase64(req.file.path);
    const dataUri = `data:${mimeType};base64,${base64}`;

    // Build a robust input object that covers common model param names
    const input = {
      // image payload under multiple common keys (some models expect `img`, some `image` or `image_url`)
      image: dataUri,
      img: dataUri,
      image_url: dataUri,

      // scale/upscale variants (some sample code uses `upscale`)
      scale: 4,
      upscale: 4,

      // model-specific options (keep these if your model accepts them)
      face_upsample: true,
      background_enhance: true,
      codeformer_fidelity: 0.1,
    };

    // Safe log: do not print entire base64 (trim)
    const safeLog = {
      ...input,
      image: (input.image || "").substring(0, 80) + "...[trimmed]",
      img: (input.img || "").substring(0, 80) + "...[trimmed]",
      image_url: (input.image_url || "").substring(0, 80) + "...[trimmed]",
    };
    console.log("[Upscale] Prepared input for model:", safeLog);

    // Run the model
    const prediction = await this.runModel(models.imageUpscale, input);
    console.log("[Upscale] Prediction finished with status:", prediction?.status);

    if (prediction.status !== "succeeded") {
      // If replicate returned an error message, include it
      const errMsg =
        prediction?.error ||
        prediction?.logs ||
        JSON.stringify(prediction?.output || prediction) ||
        "Unknown prediction failure";
      throw new Error(`Prediction failed: ${errMsg}`);
    }

    // Extract image URL robustly
    const resultUrl = this.getImageUrlFromPredictionOutput(prediction.output);
    console.log("[Upscale] Result image URL:", resultUrl);

    // Save image locally and return a public URL
    const saved = await this.saveProcessedImage(resultUrl, "upscaled");
    if (req.filesToCleanup) req.filesToCleanup.push(saved.path);

    return res.json({
      success: true,
      message: "Image upscaled",
      downloadUrl: saved.url,
      operation: "upscale",
      prediction_id: prediction?.id || null,
    });
  } catch (error) {
    // Log as much safe info as possible
    console.error("[Upscale] Error:", {
      message: error.message,
      response: error.response || error.response?.data || null,
      stack: error.stack,
    });

    // Cleanup uploaded temp file
    await this.cleanupOnError(req.file);

    // Return helpful error to client (avoid leaking secrets)
    const userMessage =
      error.message?.includes("input: img is required") ||
      /img is required/i.test(error.message)
        ? "Model expects a different image parameter (img). Server attempted multiple fallbacks."
        : error.message || "Upscale failed";

    return res.status(500).json({ error: "Upscale failed", message: userMessage });
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
// inside ImageController class
aiArt = async (req, res) => {
  // helper to publish a local file to /public/uploads so Replicate can fetch it
  const ensurePublicUrlForLocalFile = async (localPath) => {
    const uploadsDir = path.join(__dirname, "../public/uploads");
    await fs.mkdir(uploadsDir, { recursive: true });
    const baseName = path.basename(localPath);
    const dest = path.join(uploadsDir, baseName);

    // copy file to public/uploads
    await fs.copyFile(localPath, dest);

    const baseForPublic =
      process.env.PUBLIC_BASE_URL ||
      process.env.API_BASE_URL ||
      `http://127.0.0.1:${process.env.PORT || 5000}`;
    // ensure no double slashes
    return `${baseForPublic.replace(/\/$/, "")}/uploads/${encodeURIComponent(baseName)}`;
  };

  try {
    if (!req.files || req.files.length < 1) {
      return res.status(400).json({ error: "No source image provided" });
    }

    // -------------- Determine source and target paths/URLs --------------
    const sourceImagePath = req.files[0].path;
    console.log(`[AI Art] Source image: ${sourceImagePath}`);

    let targetImageUrl = req.body?.image_to_become_url || null; // remote url preferred
    let targetImagePath = null;

    if (req.files.length >= 2) {
      targetImagePath = req.files[1].path;
      console.log(`[AI Art] Local target image provided: ${targetImagePath}`);
    } else if (!targetImageUrl) {
      return res.status(400).json({
        error: "No target image provided (upload second image or provide image_to_become_url)",
      });
    } else {
      console.log(`[AI Art] Using remote target image URL: ${targetImageUrl}`);
    }

    // -------------- Params --------------
    const prompt = req.body?.prompt || "a person";
    const prompt_strength = Number(req.body?.prompt_strength || 2);
    const number_of_images = Number(req.body?.number_of_images || 1);
    const denoising_strength = Number(req.body?.denoising_strength || 1);
    const instant_id_strength = Number(req.body?.instant_id_strength || 1);
    const image_to_become_noise = Number(req.body?.image_to_become_noise || 0.3);
    const control_depth_strength = Number(req.body?.control_depth_strength || 0.8);
    const image_to_become_strength = Number(req.body?.image_to_become_strength || 0.75);
    const negative_prompt = req.body?.negative_prompt || "";
    const num_steps = Number(req.body?.num_steps || 30);
    const cfg_scale = Number(req.body?.cfg_scale || 1.5);

    // -------------- 1) SOURCE: try uploadToReplicate, else publish public URL, else base64 --------------
    let sourceImageUrl;
    try {
      console.log(`[AI Art] Attempting to upload SOURCE to Replicate: ${sourceImagePath}`);
      sourceImageUrl = await this.uploadToReplicate(sourceImagePath);
      console.log(`[AI Art] SOURCE uploaded to Replicate: ${sourceImageUrl}`);
    } catch (uploadErr) {
      console.warn("[AI Art] SOURCE upload failed:", uploadErr.message);
      // fallback: publish local file to public/uploads so Replicate can GET it
      try {
        sourceImageUrl = await ensurePublicUrlForLocalFile(sourceImagePath);
        console.log("[AI Art] SOURCE served from public URL:", sourceImageUrl);
      } catch (pubErr) {
        console.warn("[AI Art] Failed publishing SOURCE to public/uploads:", pubErr.message);
        // final fallback: base64 inline
        const base64 = await this.imageToBase64(sourceImagePath);
        const mimeType =
          req.files[0]?.mimetype ||
          mime.lookup(req.files[0]?.originalname) ||
          "image/jpeg";
        sourceImageUrl = `data:${mimeType};base64,${base64}`;
        console.log("[AI Art] SOURCE using base64 fallback");
      }
    }

    // -------------- 2) TARGET: if local, try uploadToReplicate, else publish public URL, else base64; if remote, keep it --------------
    if (targetImagePath) {
      try {
        console.log(`[AI Art] Attempting to upload TARGET to Replicate: ${targetImagePath}`);
        targetImageUrl = await this.uploadToReplicate(targetImagePath);
        console.log(`[AI Art] TARGET uploaded to Replicate: ${targetImageUrl}`);
      } catch (uploadErr) {
        console.warn("[AI Art] TARGET upload failed:", uploadErr.message);
        // fallback: publish local file to public/uploads
        try {
          targetImageUrl = await ensurePublicUrlForLocalFile(targetImagePath);
          console.log("[AI Art] TARGET served from public URL:", targetImageUrl);
        } catch (pubErr) {
          console.warn("[AI Art] Failed publishing TARGET to public/uploads:", pubErr.message);
          // final fallback: base64 inline
          const base64 = await this.imageToBase64(targetImagePath);
          const mimeType = req.files[1]?.mimetype || "image/jpeg";
          targetImageUrl = `data:${mimeType};base64,${base64}`;
          console.log("[AI Art] TARGET using base64 fallback");
        }
      }
    } else {
      // targetImageUrl already a remote URL
      console.log(`[AI Art] Using provided remote TARGET URL: ${targetImageUrl}`);
    }

    // -------------- Log summary --------------
    console.log("[AI Art] Replicate input ready:", {
      image: (sourceImageUrl || "").substring(0, 120) + "...",
      image_to_become: (targetImageUrl || "").substring(0, 120) + "...",
      prompt,
    });

    // -------------- 3) Build Replicate input and run prediction --------------
    const input = {
      image: sourceImageUrl,
      image_to_become: targetImageUrl,
      prompt,
      prompt_strength,
      number_of_images,
      denoising_strength,
      instant_id_strength,
      image_to_become_noise,
      control_depth_strength,
      image_to_become_strength,
      negative_prompt,
      num_steps,
      cfg_scale,
    };

    const prediction = await this.runModel(models.aiArt, input);

    console.log("[AI Art] Prediction status:", prediction.status);
    if (prediction.status !== "succeeded") {
      console.error("[AI Art] Prediction failed:", prediction.error || "Unknown error");
      throw new Error(`Prediction failed: ${prediction.error || "Unknown error"}`);
    }

    // -------------- 4) Extract result (robust) and save --------------
    const resultImageUrl = this.getImageUrlFromPredictionOutput(prediction.output);
    console.log("[AI Art] Result URL:", resultImageUrl);

    const saved = await this.saveProcessedImage(resultImageUrl, "ai-art");
    if (req.filesToCleanup) req.filesToCleanup.push(saved.path);

    // -------------- 5) Return --------------
    return res.json({
      success: true,
      message: "AI Art generated successfully",
      downloadUrl: saved.url,
      operation: "ai_art",
      prediction_id: prediction?.id || null,
    });
  } catch (error) {
    console.error("[AI Art] Error:", error?.response ?? error?.message ?? error);
    if (req.files) {
      req.files.forEach((file) => this.cleanupOnError(file));
    }
    return res.status(500).json({
      error: "AI Art generation failed",
      message: error?.message || String(error),
    });
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