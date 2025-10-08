const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const Replicate = require('replicate');
const { models } = require('../utils/replicateModels');
const { sampleStyles } = require('../config/styles'); // Assume this exports an object of styles; define if missing
require('dotenv').config();

class ImageController {
  constructor() {
    this.replicate = new Replicate({
      auth: process.env.REPLICATE_API_TOKEN,
    });
  }

  // Helper to extract URL from model output (handles string, array, object.url)
  getOutputUrl = (output) => {
    if (Array.isArray(output) && output.length > 0) {
      const first = output[0];
      return typeof first === 'string' ? first : (first.url || first);
    } else if (typeof output === 'string') {
      return output;
    } else if (output && output.url) {
      return output.url;
    }
    throw new Error('Unexpected output format from model');
  };

  // Convert image to base64 for Replicate API
  imageToBase64 = async (filePath) => {
    try {
      const uploadDir = path.dirname(filePath);
      await fs.mkdir(uploadDir, { recursive: true });
      const imageBuffer = await fs.readFile(filePath);
      return imageBuffer.toString('base64');
    } catch (error) {
      throw new Error(`Failed to read image file: ${error.message}`);
    }
  };

  // Save processed image and return URL
  saveProcessedImage = async (imageUrl, prefix = 'processed') => {
    try {
      const imageResponse = await axios.get(imageUrl, { 
        responseType: 'arraybuffer',
        timeout: 30000 
      });
      
      const outputFilename = `${prefix}-${Date.now()}.png`;
      const outputPath = path.join('public/processed', outputFilename);
      
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      await fs.writeFile(outputPath, imageResponse.data);
      
      return {
        filename: outputFilename,
        path: outputPath,
        url: `/processed/${outputFilename}`
      };
    } catch (error) {
      throw new Error(`Failed to save processed image: ${error.message}`);
    }
  };

  // 1. AI Background Remover
  removeBackground = async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No image file provided' });
      }

      console.log(`Removing background from: ${req.file.filename}`);

      const imageBase64 = await this.imageToBase64(req.file.path);
      const imageDataUrl = `data:${req.file.mimetype};base64,${imageBase64}`;

      const output = await this.replicate.run(models.backgroundRemover, {
        input: {
          image: imageDataUrl,
          // Model-specific defaults; adjust per schema
          format: req.body.format || "png",
          alpha_matting: req.body.alpha_matting || false
        }
      });

      const imageUrl = this.getOutputUrl(output);
      const savedImage = await this.saveProcessedImage(imageUrl, 'no-bg');
      
      if (req.filesToCleanup) {
        req.filesToCleanup.push(savedImage.path);
      }
      
      res.json({
        success: true,
        message: 'Background removed successfully',
        downloadUrl: savedImage.url,
        operation: 'background_remover'
      });
    } catch (error) {
      console.error('Background removal error:', error);
      await this.cleanupOnError(req.file);
      res.status(500).json({
        error: 'Failed to remove background',
        message: error.message
      });
    }
  };

  // 2. AI Enhancer
  enhanceImage = async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No image file provided' });
      }

      const imageBase64 = await this.imageToBase64(req.file.path);
      const imageDataUrl = `data:${req.file.mimetype};base64,${imageBase64}`;

      const output = await this.replicate.run(models.aiEnhancer, {
        input: {
          image: imageDataUrl,
          // Model-specific: scale factor, etc.
          scale: parseInt(req.body.scale) || 2,
          face_enhance: req.body.face_enhance !== 'false'
        }
      });

      const imageUrl = this.getOutputUrl(output);
      const savedImage = await this.saveProcessedImage(imageUrl, 'enhanced');
      
      if (req.filesToCleanup) {
        req.filesToCleanup.push(savedImage.path);
      }
      
      res.json({
        success: true,
        message: 'Image enhanced successfully',
        downloadUrl: savedImage.url,
        operation: 'enhancer'
      });
    } catch (error) {
      console.error('Enhancement error:', error);
      await this.cleanupOnError(req.file);
      res.status(500).json({
        error: 'Failed to enhance image',
        message: error.message
      });
    }
  };

  // 3. Magic Eraser (Object Removal)
  magicEraser = async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No image file provided' });
      }

      const { prompt = "remove object", mask_data } = req.body; // Assume client sends mask if needed

      const imageBase64 = await this.imageToBase64(req.file.path);
      const imageDataUrl = `data:${req.file.mimetype};base64,${imageBase64}`;

      const input = {
        image: imageDataUrl,
        prompt: prompt,
        // Model-specific: add mask if provided
        mask: mask_data || null,
        num_inference_steps: 20
      };

      const output = await this.replicate.run(models.magicEraser, { input });

      const imageUrl = this.getOutputUrl(output);
      const savedImage = await this.saveProcessedImage(imageUrl, 'erased');
      
      if (req.filesToCleanup) {
        req.filesToCleanup.push(savedImage.path);
      }
      
      res.json({
        success: true,
        message: 'Object removed successfully',
        downloadUrl: savedImage.url,
        operation: 'magic_eraser'
      });
    } catch (error) {
      console.error('Magic eraser error:', error);
      await this.cleanupOnError(req.file);
      res.status(500).json({
        error: 'Failed to remove object',
        message: error.message
      });
    }
  };

  // 4. AI Avatar Creator
  createAvatar = async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No image file provided' });
      }

      const { style = "digital art" } = req.body;

      const imageBase64 = await this.imageToBase64(req.file.path);
      const imageDataUrl = `data:${req.file.mimetype};base64,${imageBase64}`;

      const output = await this.replicate.run(models.avatarCreator, {
        input: {
          image: imageDataUrl,
          // Model-specific: style prompt, num outputs
          prompt: `avatar in ${style} style, high quality`,
          num_outputs: 1,
          guidance_scale: 7.5
        }
      });

      const imageUrl = this.getOutputUrl(output);
      const savedImage = await this.saveProcessedImage(imageUrl, 'avatar');
      
      if (req.filesToCleanup) {
        req.filesToCleanup.push(savedImage.path);
      }
      
      res.json({
        success: true,
        message: 'Avatar created successfully',
        downloadUrl: savedImage.url,
        operation: 'avatar_creator',
        style: style
      });
    } catch (error) {
      console.error('Avatar creation error:', error);
      await this.cleanupOnError(req.file);
      res.status(500).json({
        error: 'Failed to create avatar',
        message: error.message
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
        negative_prompt = "worst quality, low quality" 
      } = req.body;
      
      if (!prompt) {
        return res.status(400).json({ error: 'Prompt is required for text to image' });
      }

      const output = await this.replicate.run(models.textToImage, {
        input: {
          prompt: prompt,
          width: parseInt(width),
          height: parseInt(height),
          negative_prompt: negative_prompt,
          // Model-specific: fast mode params
          num_outputs: 1,
          guidance_scale: 7.5,
          num_inference_steps: 20
        }
      });

      const imageUrl = this.getOutputUrl(output);
      const savedImage = await this.saveProcessedImage(imageUrl, 'text-to-image');
      
      if (req.filesToCleanup) {
        req.filesToCleanup.push(savedImage.path);
      }
      
      res.json({
        success: true,
        message: 'Image generated successfully',
        downloadUrl: savedImage.url,
        operation: 'text_to_image',
        prompt: prompt
      });
    } catch (error) {
      console.error('Text to image error:', error);
      res.status(500).json({
        error: 'Failed to generate image from text',
        message: error.message
      });
    }
  };

  // 6. Image Upscale
  upscaleImage = async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No image file provided' });
      }

      const imageBase64 = await this.imageToBase64(req.file.path);
      const imageDataUrl = `data:${req.file.mimetype};base64,${imageBase64}`;

      const output = await this.replicate.run(models.imageUpscale, {
        input: {
          image: imageDataUrl,
          // Model-specific: scale, enhance
          scale: parseInt(req.body.scale) || 4,
          face_enhance: true
        }
      });

      const imageUrl = this.getOutputUrl(output);
      const savedImage = await this.saveProcessedImage(imageUrl, 'upscaled');
      
      if (req.filesToCleanup) {
        req.filesToCleanup.push(savedImage.path);
      }
      
      res.json({
        success: true,
        message: 'Image upscaled successfully',
        downloadUrl: savedImage.url,
        operation: 'upscale',
        scale: req.body.scale || 4
      });
    } catch (error) {
      console.error('Upscale error:', error);
      await this.cleanupOnError(req.file);
      res.status(500).json({
        error: 'Failed to upscale image',
        message: error.message
      });
    }
  };

  // 7. Style Transfer
  styleTransfer = async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No image file provided' });
      }

      const { style_key, custom_prompt } = req.body;
      
      if (!style_key && !custom_prompt) {
        return res.status(400).json({ error: 'Style key or custom prompt is required' });
      }

      const prompt = custom_prompt || (sampleStyles[style_key]?.prompt || "artistic style");

      const imageBase64 = await this.imageToBase64(req.file.path);
      const imageDataUrl = `data:${req.file.mimetype};base64,${imageBase64}`;

      const output = await this.replicate.run(models.styleTransfer, {
        input: {
          image: imageDataUrl,
          prompt: prompt,
          // Model-specific: guidance, steps
          guidance_scale: 7.5,
          num_inference_steps: 20
        }
      });

      const imageUrl = this.getOutputUrl(output);
      const savedImage = await this.saveProcessedImage(imageUrl, 'styled');
      
      if (req.filesToCleanup) {
        req.filesToCleanup.push(savedImage.path);
      }
      
      res.json({
        success: true,
        message: 'Style applied successfully',
        downloadUrl: savedImage.url,
        operation: 'style_transfer',
        style: style_key || 'custom'
      });
    } catch (error) {
      console.error('Style transfer error:', error);
      await this.cleanupOnError(req.file);
      res.status(500).json({
        error: 'Failed to apply style',
        message: error.message
      });
    }
  };

  // 8. Mockup Generator
  createMockup = async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No image file provided' });
      }

      const { bg_prompt = "professional background" } = req.body;

      const imageBase64 = await this.imageToBase64(req.file.path);
      const imageDataUrl = `data:${req.file.mimetype};base64,${imageBase64}`;

      const output = await this.replicate.run(models.mockupGenerator, {
        input: {
          image: imageDataUrl,
          bg_prompt: bg_prompt,
          // Model-specific: fast mode, quality
          fast: true,
          refine_prompt: true,
          enhance_ref_image: true
        }
      });

      const imageUrl = this.getOutputUrl(output);
      const savedImage = await this.saveProcessedImage(imageUrl, 'mockup');
      
      if (req.filesToCleanup) {
        req.filesToCleanup.push(savedImage.path);
      }
      
      res.json({
        success: true,
        message: 'Mockup created successfully',
        downloadUrl: savedImage.url,
        operation: 'mockup'
      });
    } catch (error) {
      console.error('Mockup creation error:', error);
      await this.cleanupOnError(req.file);
      res.status(500).json({
        error: 'Failed to create mockup',
        message: error.message
      });
    }
  };

  // Get available styles
  getStyles = async (req, res) => {
    try {
      // Example preset styles; expand in config/styles.js
      const styles = sampleStyles || {
        fantasy: { name: "Fantasy", prompt: "fantasy art, magical, ethereal" },
        cyberpunk: { name: "Cyberpunk", prompt: "cyberpunk, neon, futuristic" },
        anime: { name: "Anime", prompt: "anime style, Japanese animation" },
        painting: { name: "Painting", prompt: "oil painting, brush strokes" }
      };
      
      res.json({
        success: true,
        styles: styles
      });
    } catch (error) {
      console.error('Get styles error:', error);
      res.status(500).json({
        error: 'Failed to fetch styles',
        message: error.message
      });
    }
  };

  // Utility method for error cleanup
  cleanupOnError = async (file) => {
    if (file && file.path) {
      try {
        await fs.unlink(file.path);
      } catch (cleanupError) {
        console.error('Error cleaning up file:', cleanupError.message);
      }
    }
  };

  // Health check
  healthCheck = async (req, res) => {
    try {
      // Test Replicate connection
      await this.replicate.models.get('stability-ai/stable-diffusion'); // Simple API test
      res.json({ 
        status: 'healthy', 
        service: 'Replicate API',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      res.status(503).json({
        status: 'unhealthy',
        service: 'Replicate API',
        error: error.message
      });
    }
  };
}

module.exports = new ImageController();