// utils/imageUtils.js
const Replicate = require("replicate");
const fs = require("fs").promises;
const path = require("path");
const axios = require("axios");

const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

async function uploadToReplicate(filePath) {
  const fileData = await fs.readFile(filePath);
  const ext = path.extname(filePath).toLowerCase() || ".jpg";
  const mimeType = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : "image/png";
  const fileName = path.basename(filePath) || `upload-${Date.now()}${ext}`;

  console.log(`[uploadToReplicate] Uploading ${fileName} as ${mimeType}`);
  const response = await axios.post(
    "https://api.replicate.com/v1/files",
    fileData,
    {
      headers: {
        Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}`,
        "Content-Type": mimeType,
        "Content-Disposition": `attachment; filename="${fileName}"`,
      },
    }
  );
  console.log(`[uploadToReplicate] Uploaded file URL: ${response.data.url}`);
  return response.data.url;
}

async function imageToBase64(filePath) {
  const fileData = await fs.readFile(filePath);
  return fileData.toString("base64");
}

async function saveProcessedImage(imageUrl, operation) {
  const response = await axios.get(imageUrl, { responseType: "arraybuffer" });
  const fileName = `${operation}-${Date.now()}.png`;
  const filePath = path.join(__dirname, "../../processed", fileName);
  await fs.writeFile(filePath, response.data);
  return { url: `https://pixeeaibackend.depaymprotocol.com/processed/${fileName}`, path: filePath };
}

async function cleanupOnError(file) {
  if (file?.path) {
    try {
      await fs.unlink(file.path);
      console.log(`[Cleanup] Removed ${file.path}`);
    } catch (err) {
      console.error(`[Cleanup] Failed to remove ${file.path}:`, err.message);
    }
  }
}

module.exports = {
  uploadToReplicate,
  imageToBase64,
  saveProcessedImage,
  cleanupOnError,
  // ... other utilities
};