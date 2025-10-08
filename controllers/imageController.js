const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const Replicate = require('replicate');
const { models } = require('../utils/replicateModels');
const { sampleStyles } = require('../config/styles');
require('dotenv').config();

class ImageController {
  constructor() {
    this.replicate = new Replicate({
      auth: process.env.REPLICATE_API_TOKEN,
    });
  }

  // Convert image to base64 for Replicate API
  async imageToBase64(filePath) {
    try {
      const imageBuffer = await fs.readFile(filePath);
      return imageBuffer.toString('base64');
    } catch (error) {
      throw new Error(`Failed to read image file: ${error.message}`);
    }
  }

  // Save processed image and return URL
  async saveProcessedImage(imageUrl, prefix = 'processed') {
    try {
      const imageResponse = await axios.get(imageUrl, { 
        responseType: 'arraybuffer',
        timeout: 30000 
      });
      
      const outputFilename = `${prefix}-${Date.now()}.png`;
      const outputPath = path.join('public/processed', outputFilename);
      
      // Ensure directory exists
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
  }

  // 1. AI Background Remover
  async removeBackground(req, res) {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No image file provided' });
      }

      console.log(`Removing background from: ${req.file.filename}`);

      const imageBase64 = await this.imageToBase64(req.file.path);
      const imageDataUrl = `data:${req.file.mimetype};base64,${imageBase64}`;

      const output = await this.replicate.run(
        models.backgroundRemover.id,
        {
          input: {
            image: imageDataUrl,
            format: "png",
            reverse: false,
            threshold: 0,
            background_type: "rgba"
          }
        }
      );

      if (output && output.url) {
        const savedImage = await this.saveProcessedImage(output.url, 'no-bg');
        
        // Track files for cleanup
        if (req.filesToCleanup) {
          req.filesToCleanup.push(savedImage.path);
        }
        
        res.json({
          success: true,
          message: 'Background removed successfully',
          downloadUrl: savedImage.url,
          operation: 'background_remover'
        });
      } else {
        throw new Error('Unexpected response from background removal service');
      }

    } catch (error) {
      console.error('Background removal error:', error);
      await this.cleanupOnError(req.file);
      res.status(500).json({
        error: 'Failed to remove background',
        message: error.message
      });
    }
  }

  // 2. AI Enhancer
  async enhanceImage(req, res) {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No image file provided' });
      }

      const imageBase64 = await this.imageToBase64(req.file.path);
      const imageDataUrl = `data:${req.file.mimetype};base64,${imageBase64}`;

      const output = await this.replicate.run(
        models.aiEnhancer.id,
        {
          input: {
            image: imageDataUrl,
            aligned: false
          }
        }
      );

      if (output) {
        // VQFR returns the enhanced image directly
        const savedImage = await this.saveProcessedImage(output, 'enhanced');
        
        if (req.filesToCleanup) {
          req.filesToCleanup.push(savedImage.path);
        }
        
        res.json({
          success: true,
          message: 'Image enhanced successfully',
          downloadUrl: savedImage.url,
          operation: 'enhancer'
        });
      } else {
        throw new Error('Unexpected response from enhancement service');
      }

    } catch (error) {
      console.error('Enhancement error:', error);
      await this.cleanupOnError(req.file);
      res.status(500).json({
        error: 'Failed to enhance image',
        message: error.message
      });
    }
  }

  // 3. Magic Eraser (Object Removal)
  async magicEraser(req, res) {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No image file provided' });
      }

      const { prompt = "background" } = req.body;

      const imageBase64 = await this.imageToBase64(req.file.path);
      const imageDataUrl = `data:${req.file.mimetype};base64,${imageBase64}`;

      const output = await this.replicate.run(
        models.magicEraser.id,
        {
          input: {
            image: imageDataUrl,
            prompt: prompt,
            number_of_images: 1,
            prompt_strength: 2
          }
        }
      );

      if (output && output[0]) {
        const savedImage = await this.saveProcessedImage(output[0].url, 'erased');
        
        if (req.filesToCleanup) {
          req.filesToCleanup.push(savedImage.path);
        }
        
        res.json({
          success: true,
          message: 'Object removed successfully',
          downloadUrl: savedImage.url,
          operation: 'magic_eraser'
        });
      } else {
        throw new Error('Unexpected response from magic eraser service');
      }

    } catch (error) {
      console.error('Magic eraser error:', error);
      await this.cleanupOnError(req.file);
      res.status(500).json({
        error: 'Failed to remove object',
        message: error.message
      });
    }
  }

  // 4. AI Avatar Creator
  async createAvatar(req, res) {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No image file provided' });
      }

      const { 
        prompt = "portrait, high quality, detailed face",
        style = "digital art" 
      } = req.body;

      const imageBase64 = await this.imageToBase64(req.file.path);
      const imageDataUrl = `data:${req.file.mimetype};base64,${imageBase64}`;

      const output = await this.replicate.run(
        models.avatarCreator.id,
        {
          input: {
            prompt: prompt,
            cfg_scale: 1.2,
            num_steps: 4,
            image_width: 768,
            num_samples: 1,
            image_height: 1024,
            output_format: "webp",
            identity_scale: 0.8,
            mix_identities: false,
            output_quality: 80,
            generation_mode: "fidelity",
            main_face_image: imageDataUrl,
            negative_prompt: "flaws in the eyes, flaws in the face, flaws, lowres, non-HDRi, low quality, worst quality, artifacts noise, text, watermark, glitch, deformed, mutated, ugly, disfigured, hands, low resolution, partially rendered objects, deformed or partially rendered eyes, deformed, deformed eyeballs, cross-eyed, blurry"
          }
        }
      );

      if (output && output[0]) {
        const savedImage = await this.saveProcessedImage(output[0].url, 'avatar');
        
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
      } else {
        throw new Error('Unexpected response from avatar creator service');
      }

    } catch (error) {
      console.error('Avatar creation error:', error);
      await this.cleanupOnError(req.file);
      res.status(500).json({
        error: 'Failed to create avatar',
        message: error.message
      });
    }
  }

  // 5. Text to Image
  async textToImage(req, res) {
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

      const output = await this.replicate.run(
        models.textToImage.id,
        {
          input: {
            seed: Math.floor(Math.random() * 1000000),
            width: parseInt(width),
            height: parseInt(height),
            prompt: prompt,
            scheduler: "K_EULER",
            num_outputs: 1,
            guidance_scale: 0,
            negative_prompt: negative_prompt,
            num_inference_steps: 4
          }
        }
      );

      if (output && output[0]) {
        const savedImage = await this.saveProcessedImage(output[0].url, 'text-to-image');
        
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
      } else {
        throw new Error('Unexpected response from text to image service');
      }

    } catch (error) {
      console.error('Text to image error:', error);
      res.status(500).json({
        error: 'Failed to generate image from text',
        message: error.message
      });
    }
  }

  // 6. Image Upscale
  async upscaleImage(req, res) {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No image file provided' });
      }

      const imageBase64 = await this.imageToBase64(req.file.path);
      const imageDataUrl = `data:${req.file.mimetype};base64,${imageBase64}`;

      const output = await this.replicate.run(
        models.imageUpscale.id,
        {
          input: {
            image: imageDataUrl,
            upscale: parseInt(req.body.scale) || 2,
            face_upsample: true,
            background_enhance: true,
            codeformer_fidelity: 0.5
          }
        }
      );

      if (output && output.url) {
        const savedImage = await this.saveProcessedImage(output.url, 'upscaled');
        
        if (req.filesToCleanup) {
          req.filesToCleanup.push(savedImage.path);
        }
        
        res.json({
          success: true,
          message: 'Image upscaled successfully',
          downloadUrl: savedImage.url,
          operation: 'upscale',
          scale: req.body.scale || 2
        });
      } else {
        throw new Error('Unexpected response from upscale service');
      }

    } catch (error) {
      console.error('Upscale error:', error);
      await this.cleanupOnError(req.file);
      res.status(500).json({
        error: 'Failed to upscale image',
        message: error.message
      });
    }
  }

  // 7. Style Transfer
  async styleTransfer(req, res) {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No image file provided' });
      }

      const { style_prompt, style_image_url } = req.body;
      
      if (!style_prompt && !style_image_url) {
        return res.status(400).json({ error: 'Style prompt or style image URL is required' });
      }

      const imageBase64 = await this.imageToBase64(req.file.path);
      const imageDataUrl = `data:${req.file.mimetype};base64,${imageBase64}`;

      const output = await this.replicate.run(
        models.styleTransfer.id,
        {
          input: {
            image: imageDataUrl,
            prompt: style_prompt || "artistic style",
            image_to_become: style_image_url || imageDataUrl, // Fallback to same image
            number_of_images: 1,
            prompt_strength: 2
          }
        }
      );

      if (output && output[0]) {
        const savedImage = await this.saveProcessedImage(output[0].url, 'styled');
        
        if (req.filesToCleanup) {
          req.filesToCleanup.push(savedImage.path);
        }
        
        res.json({
          success: true,
          message: 'Style applied successfully',
          downloadUrl: savedImage.url,
          operation: 'style_transfer'
        });
      } else {
        throw new Error('Unexpected response from style transfer service');
      }

    } catch (error) {
      console.error('Style transfer error:', error);
      await this.cleanupOnError(req.file);
      res.status(500).json({
        error: 'Failed to apply style',
        message: error.message
      });
    }
  }

  // 8. Mockup Generator
  async createMockup(req, res) {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No image file provided' });
      }

      const { bg_prompt = "professional background" } = req.body;

      const imageBase64 = await this.imageToBase64(req.file.path);
      const imageDataUrl = `data:${req.file.mimetype};base64,${imageBase64}`;

      const output = await this.replicate.run(
        models.mockupGenerator.id,
        {
          input: {
            image: imageDataUrl,
            bg_prompt: bg_prompt,
            fast: true,
            sync: true,
            force_rmbg: false,
            refine_prompt: true,
            original_quality: false,
            enhance_ref_image: true,
            content_moderation: false
          }
        }
      );

      if (output && output[0]) {
        const savedImage = await this.saveProcessedImage(output[0].url, 'mockup');
        
        if (req.filesToCleanup) {
          req.filesToCleanup.push(savedImage.path);
        }
        
        res.json({
          success: true,
          message: 'Mockup created successfully',
          downloadUrl: savedImage.url,
          operation: 'mockup'
        });
      } else {
        throw new Error('Unexpected response from mockup service');
      }

    } catch (error) {
      console.error('Mockup creation error:', error);
      await this.cleanupOnError(req.file);
      res.status(500).json({
        error: 'Failed to create mockup',
        message: error.message
      });
    }
  }

  // Get available styles
  async getStyles(req, res) {
    try {
      // You can define some preset styles
      const styles = {
        fantasy: { name: "Fantasy", prompt: "fantasy art, magical, ethereal" },
        cyberpunk: { name: "Cyberpunk", prompt: "cyberpunk, neon, futuristic" },
        anime: { name: "Anime", prompt: "anime style, Japanese animation" },
        oil_painting: { name: "Oil Painting", prompt: "oil painting, brush strokes" }
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
  }

  // Utility method for error cleanup
  async cleanupOnError(file) {
    if (file && file.path) {
      try {
        await fs.unlink(file.path);
      } catch (cleanupError) {
        console.error('Error cleaning up file:', cleanupError.message);
      }
    }
  }

  // Health check
  async healthCheck(req, res) {
    try {
      // Simple health check - if we can instantiate Replicate, we're good
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
  }
}

module.exports = new ImageController();