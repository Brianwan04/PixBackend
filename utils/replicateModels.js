// utils/replicateModels.js
module.exports = {
  models: {
    // Background Remover - Using 851-labs/background-remover (unpinned)
    backgroundRemover: {
      id: "851-labs/background-remover",
      name: "Background Remover"
    },
    
    // AI Enhancer - Using tencentarc/vqfr (unpinned)
    aiEnhancer: {
      id: "tencentarc/vqfr",
      name: "VQFR Enhancer"
    },
    
    // Magic Eraser - Using stability-ai/stable-diffusion-inpainting (pinned version)
    magicEraser: {
      id: "stability-ai/stable-diffusion-inpainting:95a366c6de1b434f8c9b330b31b6b5b5b0c6a15aa0b12de8ffe033c4908939a5",
      name: "Stable Diffusion Inpainting"
    },
    
    // Avatar Creator - Using bytedance/pulid (unpinned)
    avatarCreator: {
      id: "bytedance/pulid",
      name: "Pulid Avatar"
    },
    
    // Text to Image - Corrected to bytedance/sdxl-lightning-4step (unpinned)
    textToImage: {
      id: "bytedance/sdxl-lightning-4step",
      name: "SDXL Lightning"
    },
    
    // Image Upscale - Using sczhou/codeformer (unpinned)
    imageUpscale: {
      id: "sczhou/codeformer",
      name: "CodeFormer Upscale"
    },
    
    // Style Transfer - Using stability-ai/stable-diffusion (pinned version)
    styleTransfer: {
      id: "stability-ai/stable-diffusion:27b93a2413e7f36cd83da926f3656280b2931564ff050bf9575f1fdf9bcd7478",
      name: "Stable Diffusion Style Transfer"
    },
    
    // Mockup Generator - Using bria/generate-background (unpinned)
    mockupGenerator: {
      id: "bria/generate-background",
      name: "Bria Background Generator"
    },
    
    // AI Art - Using fofr/become-image (unpinned)
    aiArt: {
      id: "fofr/become-image",
      name: "Become Image"
    },
    
    // AI Background Generation - Using bria/generate-background (unpinned, same as mockup)
    bgGenerator: {
      id: "bria/generate-background",
      name: "Bria Background Generator"
    }
  }
};
