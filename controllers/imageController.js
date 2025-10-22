// controllers/imageController.js
const axios = require("axios");
const fs = require("fs").promises;
const path = require("path");
const FormData = require("form-data");
const fsExtra = require("fs");
const mime = require("mime"); // Explicit import
const { models } = require("../utils/replicateModels");
const { sampleStyles } = require("../config/styles");
require("dotenv").config();

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

  uploadToReplicate = async (filePath) => {
    const form = new FormData();
    const filename = path.basename(filePath);
    const mimeType = mime.getType(filename) || "image/jpeg"; // Use mime directly
    form.append("file", fsExtra.createReadStream(filePath), filename);
    form.append("filename", filename);
    form.append("type", mimeType);

    const headers = {
      Authorization: `Token ${this.token}`,
      ...form.getHeaders(),
    };

    try {
      const length = await new Promise((resolve, reject) => {
        form.getLength((err, len) => (err ? reject(err) : resolve(len)));
      });
      if (length) headers["Content-Length"] = length;
    } catch (lenErr) {
      console.warn("[uploadToReplicate] getLength failed:", lenErr.message);
    }

    const url = "https://api.replicate.com/v1/files";
    const res = await axios.post(url, form, {
      headers,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      timeout: 120000,
      validateStatus: null,
    });

    console.log("[uploadToReplicate] Response status:", res.status, "data:", res.data);
    if (res.status >= 400) {
      throw new Error(`Failed to upload: ${JSON.stringify(res.data)}`);
    }

    const publicUrl = res.data.urls?.get || res.data.url;
    if (!publicUrl) {
      throw new Error("No public URL returned");
    }
    return publicUrl;
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
    try {
      const verifyResponse = await axios.head(`http://127.0.0.1:5000${fileUrl}`, { timeout: 5000 });
      console.log(`[saveProcessedImage] Local file verification status: ${verifyResponse.status}`);
    } catch (verifyErr) {
      console.error(`[saveProcessedImage] Local file verification failed: ${verifyErr.message}`);
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

  // 4. AI Avatar Creator
  // Replace your existing createAvatar with this method
  /*
createAvatar = async (req, res) => {
  // helper to pick file node from req.file or req.files
  const pickFileFromRequest = (r) => {
    if (!r) return null;
    if (r.file) return r.file;
    if (r.files) {
      // Prioritize common keys
      const keys = ["main_face_image", "image", "file"];
      for (const k of keys) {
        if (Array.isArray(r.files[k]) && r.files[k][0]) return r.files[k][0];
        if (r.files[k] && !Array.isArray(r.files[k]) && r.files[k].path) return r.files[k]; // multer sometimes
      }
      // fallback: first array entry
      const firstKey = Object.keys(r.files)[0];
      if (firstKey && Array.isArray(r.files[firstKey])) return r.files[firstKey][0];
      if (firstKey && r.files[firstKey] && r.files[firstKey].path) return r.files[firstKey];
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
    const userPrompt = (req.body?.prompt || "").trim();
    const style = req.body?.style || req.body?.style_id || "fantasy";
    const prompt = userPrompt ? `${userPrompt}` : `Portrait of the provided face — ${style} style. High detail, clean background, sharp facial detail, professional lighting.`;
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

    // Determine main_face_image input: try upload to Replicate first, then fallback to data URL if upload fails
    let mainFaceInput = remoteFaceUrl;
    if (uploadedFile) {
      try {
        console.log(`[Avatar] Uploading local file to Replicate: ${uploadedFile.path}`);
        mainFaceInput = await this.uploadToReplicate(uploadedFile.path);
        console.log(`[Avatar] Upload successful: ${mainFaceInput}`);
      } catch (uploadErr) {
        // Log the upload error and fall back to inlining the image as base64 data URL
        console.error("[Avatar] uploadToReplicate failed, falling back to base64 data URL. Error:", uploadErr && (uploadErr.response?.data || uploadErr.message || uploadErr));
        try {
          const base64 = await this.imageToBase64(uploadedFile.path);
          mainFaceInput = `data:${uploadedFile.mimetype};base64,${base64}`;
          console.log("[Avatar] Using base64 data URL fallback for main_face_image");
        } catch (readErr) {
          console.error("[Avatar] Failed to read file for base64 fallback:", readErr);
          // cleanup and rethrow to send error response
          await this.cleanupOnError(uploadedFile);
          return res.status(500).json({ error: "Avatar creation failed", message: "Failed to upload and failed to read file for fallback" });
        }
      }
    }

    // Build input object modeled after the Replicate example
    const input = {
      prompt,
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

    // Run the model
    console.log("[Avatar] Creating prediction with input keys:", Object.keys(input));
  const prediction = await this.runModel(models.avatarCreator, input);

  // Add this check
  console.log("[Avatar] Prediction response:", JSON.stringify(prediction)); // Add this for debugging

if (prediction.status !== 'succeeded') {
  const errMsg = prediction.error || 'Unknown error';
  console.error("[Avatar] Prediction failed:", errMsg, "Full response:", JSON.stringify(prediction));
  throw new Error(`Prediction failed: ${errMsg}`);
}


  // Extract image URL robustly from the prediction.output
  const imageUrl = this.getImageUrlFromPredictionOutput(prediction.output);
    console.log("[Avatar] Prediction succeeded, image URL:", imageUrl);

    // Save processed image locally
    const saved = await this.saveProcessedImage(imageUrl, "avatar");
    if (req.filesToCleanup) req.filesToCleanup.push(saved.path);

    // Optionally cleanup uploadedFile (we rely on cleanupTrackedFiles middleware or manual cleanup)
    // respond with success
    res.json({
      success: true,
      message: "Avatar created",
      downloadUrl: saved.url,
      operation: "avatar_creator",
      prediction_id: prediction?.id || null,
    });
  } catch (error) {
    console.error("[Avatar] Error:", error && (error.response?.data || error.message || error));
    // cleanup any uploaded file saved by multer
    const file = (req.file) || (req.files && (req.files.main_face_image?.[0] || req.files.image?.[0] || req.files.file?.[0]));
    await this.cleanupOnError(file);
    const msg = error?.response?.data || error?.message || String(error);
    res.status(500).json({ error: "Avatar creation failed", message: msg });
  }
};*/
createAvatar = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No image provided" });
    }

    const prompt = req.body?.prompt || "portrait, watercolor style, dramatic lighting";
    const cfg_scale = Number(req.body?.cfg_scale || 1.2);
    const num_steps = Number(req.body?.num_steps || 4);
    const image_width = Number(req.body?.image_width || 768);
    const image_height = Number(req.body?.image_height || 1024);
    const num_samples = Number(req.body?.num_samples || 4);
    const output_format = req.body?.output_format || "webp";
    const identity_scale = Number(req.body?.identity_scale || 0.8);
    const mix_identities = req.body?.mix_identities === "true" || false;
    const output_quality = Number(req.body?.output_quality || 80);
    const generation_mode = req.body?.generation_mode || "fidelity";
    const negative_prompt = req.body?.negative_prompt || "flaws in the eyes, flaws in the face, flaws, lowres, non-HDRi, low quality, worst quality, artifacts noise, text, watermark, glitch, deformed, mutated, ugly, disfigured, hands, low resolution, partially rendered objects, deformed or partially rendered eyes, deformed, deformed eyeballs, cross-eyed, blurry";

    let imageInput = null;
    try {
      console.log(`[Avatar] Uploading source image: ${req.file.path}`);
      imageInput = await this.uploadToReplicate(req.file.path);
      console.log(`[Avatar] Uploaded URL: ${imageInput}`);
    } catch (uploadErr) {
      console.error("[Avatar] uploadToReplicate failed:", uploadErr.message);
      const base64 = await this.imageToBase64(req.file.path);
      const mimeType = req.file.mimetype || mime.getType(req.file.originalname) || "image/jpeg";
      imageInput = `data:${mimeType};base64,${base64}`;
      console.log("[Avatar] Using base64 data URL");
    }

    const input = {
      prompt,
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
      main_face_image: imageInput,
      negative_prompt,
    };

    console.log("[Avatar] Creating prediction with input:", Object.keys(input));
    const prediction = await this.runModel(models.avatarCreator, input);
    console.log("[Avatar] Prediction response:", JSON.stringify(prediction, null, 2));

    if (prediction.status !== "succeeded") {
      console.error("[Avatar] Prediction failed:", prediction.error || "Unknown error");
      throw new Error(`Prediction failed: ${prediction.error || "Unknown error"}`);
    }

    const imageUrl = this.getImageUrlFromPredictionOutput(prediction.output);
    console.log("[Avatar] Extracted image URL:", imageUrl);

    try {
      const verifyResponse = await axios.head(imageUrl, { timeout: 10000 });
      console.log("[Avatar] Image URL verification status:", verifyResponse.status, "Content-Type:", verifyResponse.headers["content-type"]);
      if (verifyResponse.status >= 400) {
        throw new Error(`Image URL inaccessible: ${verifyResponse.status}`);
      }
    } catch (verifyErr) {
      console.error("[Avatar] Image URL verification failed:", verifyErr.message);
      throw verifyErr;
    }

    const saved = await this.saveProcessedImage(imageUrl, "avatar");
    if (req.filesToCleanup) req.filesToCleanup.push(saved.path);

    return res.json({
      success: true,
      message: "Avatar created",
      downloadUrl: saved.url,
      operation: "avatar_creator",
      prediction_id: prediction?.id || null,
    });
  } catch (error) {
    console.error("[Avatar] Error:", error.message, error);
    if (req.file) await this.cleanupOnError(req.file);
    return res.status(500).json({ error: "Avatar creation failed", message: error.message });
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
/*
  aiArt = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No source image provided" });
    }
    const imageToBecomeUrl = req.body?.image_to_become;
    if (!imageToBecomeUrl) {
      return res.status(400).json({ error: "No image_to_become URL provided" });
    }

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

    let imageInput = null;
    let usedUploadedUrl = false;

    // Upload to Replicate (or other file host)
    try {
      console.log(`[AI Art] Uploading source image to Replicate: ${req.file.path}`);
      const uploadedUrl = await this.uploadToReplicate(req.file.path);
      console.log(`[AI Art] Source image upload returned URL: ${uploadedUrl}`);

      // Quick checks: is it data URI, replicate file URL, has extension?
      if (typeof uploadedUrl === "string" && uploadedUrl.startsWith("data:")) {
        imageInput = uploadedUrl;
        usedUploadedUrl = false;
        console.log("[AI Art] Upload returned data URI — using it directly.");
      } else {
        const looksLikeReplicateFile = typeof uploadedUrl === "string" && /\/v1\/files\//.test(uploadedUrl);
        const hasExt = typeof uploadedUrl === "string" && /\.[a-zA-Z0-9]{2,5}($|\?)/.test(uploadedUrl);

        // Try to fetch the uploaded URL to inspect headers & bytes
        let fetchedBuffer = null;
        let fetchedContentType = null;
        let fetchedStatus = null;
        try {
          const fetched = await axios.get(uploadedUrl, {
            method: "GET",
            responseType: "arraybuffer",
            timeout: 20000,
            validateStatus: null,
          });
          fetchedStatus = fetched.status;
          fetchedContentType = fetched.headers && (fetched.headers["content-type"] || fetched.headers["Content-Type"]);
          console.log("[AI Art] fetched uploadedUrl status:", fetchedStatus, "content-type:", fetchedContentType);
          if (fetchedStatus >= 200 && fetchedStatus < 300) {
            fetchedBuffer = Buffer.from(fetched.data, "binary");
          } else {
            console.warn("[AI Art] fetching uploaded URL returned non-2xx status:", fetchedStatus);
          }
        } catch (fetchErr) {
          console.warn("[AI Art] Error fetching uploadedUrl for inspection (will fallback to base64):", fetchErr && (fetchErr.message || fetchErr));
        }

        // Decide whether to use URL directly or convert to inline base64 data URI
        const contentTypeLooksImage = fetchedContentType && /^image\//i.test(fetchedContentType);
        if (!hasExt || looksLikeReplicateFile || !contentTypeLooksImage) {
          // Convert to data URI (prefer fetched bytes, else local file)
          if (fetchedBuffer) {
            const contentType = fetchedContentType || req.file.mimetype || "image/jpeg";
            const b64 = fetchedBuffer.toString("base64");
            imageInput = `data:${contentType};base64,${b64}`;
            console.log("[AI Art] Converted fetched uploadedUrl to data URI (content-type):", contentType, "b64 bytes:", b64.length);
          } else {
            // Fallback: read local file and create base64 data URI
            console.log("[AI Art] No fetched buffer — creating data URI from local file fallback");
            const localBase64 = await this.imageToBase64(req.file.path);
            const mimeTypeFallback = req.file.mimetype || "image/jpeg";
            imageInput = `data:${mimeTypeFallback};base64,${localBase64}`;
            console.log("[AI Art] Created data URI from local file fallback (length):", localBase64.length);
          }
          usedUploadedUrl = false;
        } else {
          // Safe to use uploaded URL directly
          imageInput = uploadedUrl;
          usedUploadedUrl = true;
          console.log("[AI Art] Uploaded URL looks safe — using URL directly.");
        }
      }
    } catch (uploadErr) {
      // Upload failed — fallback to reading local file as data URI
      console.error("[AI Art] uploadToReplicate failed — using local base64 fallback:", uploadErr && (uploadErr.response?.data || uploadErr.message || uploadErr));
      const base64 = await this.imageToBase64(req.file.path);
      const mimeType = req.file.mimetype || (require("mime")?.getType(req.file.originalname) || "image/jpeg");
      imageInput = `data:${mimeType};base64,${base64}`;
      usedUploadedUrl = false;
      console.log("[AI Art] Using base64 data URL for source image (upload failed)");
    }

    // Build input for the model
    const input = {
      image: imageInput,
      image_to_become: imageToBecomeUrl,
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

    console.log("[AI Art] Creating prediction with input keys:", Object.keys(input), "usedUploadedUrl:", usedUploadedUrl);
    const prediction = await this.runModel(models.aiArt, input);

    console.log("[AI Art] Prediction response:", JSON.stringify(prediction));

    if (prediction.status !== "succeeded") {
      const errMsg = prediction.error || "Unknown error";
      console.error("[AI Art] Prediction failed:", errMsg, "full response:", JSON.stringify(prediction));

      // If it's likely a file-type issue and we didn't already use inline base64, retry forcing local base64
      if ((!imageInput || !String(imageInput).startsWith("data:")) && (String(errMsg).toLowerCase().includes("unsupported file") || String(errMsg).toLowerCase().includes("unsupported file type"))) {
        console.log("[AI Art] Detected unsupported file error — retrying with inline base64 from local file.");
        try {
          const base64 = await this.imageToBase64(req.file.path);
          const mimeType = req.file.mimetype || (require("mime")?.getType(req.file.originalname) || "image/jpeg");
          const fallbackImage = `data:${mimeType};base64,${base64}`;
          const retryInput = { ...input, image: fallbackImage };
          const retryPrediction = await this.runModel(models.aiArt, retryInput);

          if (retryPrediction.status !== "succeeded") {
            console.error("[AI Art] Retry prediction failed:", JSON.stringify(retryPrediction));
            throw new Error(retryPrediction.error || "Retry prediction failed");
          }

          const imageUrlRetry = this.getImageUrlFromPredictionOutput(retryPrediction.output);
          const savedRetry = await this.saveProcessedImage(imageUrlRetry, "ai-art");
          if (req.filesToCleanup) req.filesToCleanup.push(savedRetry.path);
          return res.json({
            success: true,
            message: "AI Art generated (retry)",
            downloadUrl: savedRetry.url,
            operation: "ai_art",
            prediction_id: retryPrediction?.id || null,
          });
        } catch (retryErr) {
          console.error("[AI Art] Retry also failed:", retryErr && (retryErr.response?.data || retryErr.message || retryErr));
          // allow outer catch to handle response
          throw retryErr;
        }
      }

      // Not a retryable type error or retry exhausted
      throw new Error(`Prediction failed: ${errMsg}`);
    }

    // Successful prediction
    const imageUrl = this.getImageUrlFromPredictionOutput(prediction.output);
    console.log("[AI Art] Prediction succeeded, image URL:", imageUrl);

    const saved = await this.saveProcessedImage(imageUrl, "ai-art");
    if (req.filesToCleanup) req.filesToCleanup.push(saved.path);

    return res.json({
      success: true,
      message: "AI Art generated",
      downloadUrl: saved.url,
      operation: "ai_art",
      prediction_id: prediction?.id || null,
    });
  } catch (error) {
    console.error("[AI Art] Error:", error && (error.response?.data || error.message || error));
    // cleanup uploaded/multer file
    const file = req.file;
    if (file) await this.cleanupOnError(file);
    const msg = error?.response?.data || error?.message || String(error);
    return res.status(500).json({ error: "AI Art generation failed", message: msg });
  }
};*/
aiArt = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No source image provided" });
    }
    const imageToBecomeUrl = req.body?.image_to_become;
    if (!imageToBecomeUrl) {
      return res.status(400).json({ error: "No image_to_become URL provided" });
    }

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

    let imageInput = null;
    try {
      console.log(`[AI Art] Uploading source image: ${req.file.path}`);
      imageInput = await this.uploadToReplicate(req.file.path);
      console.log(`[AI Art] Uploaded URL: ${imageInput}`);
    } catch (uploadErr) {
      console.error("[AI Art] uploadToReplicate failed:", uploadErr.message);
      const base64 = await this.imageToBase64(req.file.path);
      const mimeType = req.file.mimetype || mime.getType(req.file.originalname) || "image/jpeg";
      imageInput = `data:${mimeType};base64,${base64}`;
      console.log("[AI Art] Using base64 data URL");
    }

    const input = {
      image: imageInput,
      image_to_become: imageToBecomeUrl,
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

    console.log("[AI Art] Creating prediction with input:", Object.keys(input));
    const prediction = await this.runModel(models.aiArt, input);
    console.log("[AI Art] Prediction response:", JSON.stringify(prediction, null, 2));

    if (prediction.status !== "succeeded") {
      console.error("[AI Art] Prediction failed:", prediction.error || "Unknown error");
      throw new Error(`Prediction failed: ${prediction.error || "Unknown error"}`);
    }

    const imageUrl = this.getImageUrlFromPredictionOutput(prediction.output);
    console.log("[AI Art] Extracted image URL:", imageUrl);

    // Verify image URL
    try {
      const verifyResponse = await axios.head(imageUrl, { timeout: 10000 });
      console.log("[AI Art] Image URL verification status:", verifyResponse.status, "Content-Type:", verifyResponse.headers["content-type"]);
      if (verifyResponse.status >= 400) {
        throw new Error(`Image URL inaccessible: ${verifyResponse.status}`);
      }
    } catch (verifyErr) {
      console.error("[AI Art] Image URL verification failed:", verifyErr.message);
      throw verifyErr;
    }

    const saved = await this.saveProcessedImage(imageUrl, "ai-art");
    if (req.filesToCleanup) req.filesToCleanup.push(saved.path);

    return res.json({
      success: true,
      message: "AI Art generated",
      downloadUrl: saved.url,
      operation: "ai_art",
      prediction_id: prediction?.id || null,
    });
  } catch (error) {
    console.error("[AI Art] Error:", error.message, error);
    if (req.file) await this.cleanupOnError(req.file);
    return res.status(500).json({ error: "AI Art generation failed", message: error.message });
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