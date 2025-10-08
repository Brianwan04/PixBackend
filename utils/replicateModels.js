// PixBackend/utils/replicateModels.js

// utils/replicateModels.js
module.exports = {
  models: {
    backgroundRemover: {
      id: "851-labs/background-remover",
      name: "Background Remover"
    },
    aiEnhancer: {
      id: "tencentarc/vqfr",
      name: "VQFR Enhancer"
    },
    avatarCreator: {
      id: "bytedance/pulid",
      name: "Pulid Avatar"
    },
    textToImage: {
      id: "bytedance/sdxl-lightning-4step",
      name: "SDXL Lightning"
    },
    imageUpscale: {
      id: "sczhou/codeformer",
      name: "CodeFormer Upscale"
    },
    aiArt: {
      id: "fofr/become-image",
      name: "Become Image"
    },
    bgGenerator: {
      id: "bria/generate-background", // unpinned; you can pin to a version later
      name: "Bria Background Generator"
    },
    // placeholders for models you didn't pin — add versions later
    magicEraser: { id: "stability-ai/stable-diffusion-inpainting:95a366c6de1b434f8c9b330b31b6b5b5b0c6a15aa0b12de8ffe033c4908939a5", name: "Inpainting (placeholder)" },
    styleTransfer: { id: "stability-ai/stable-diffusion:27b93a2413e7f36cd83da926f3656280b2931564ff050bf9575f1fdf9bcd7478", name: "Style Transfer (placeholder)" },
    mockupGenerator: { id: "mia/mockup-placeholder:latest", name: "Mockup (placeholder)" }
  }
};


/*
module.exports = {
  models: {
    // Background Remover
    backgroundRemover: {
      id: "cjwbw/rembg:fb8af171cfa1616ddcf1242c093f9c46bcada5ad4cf6f2fbe8b81b330ec5c003",
      name: "Background Remover"
    },
    
    // AI Enhancer
    aiEnhancer: {
      id: "nightmareai/real-esrgan:42fed1c4974146d4d2414e2be2c5277c7fcf05fcc3a73abf41610695738c1d7b",
      name: "AI Enhancer"
    },
    
    // Magic Eraser (Inpainting)
    magicEraser: {
      id: "stability-ai/stable-diffusion-inpainting:95a366c6de1b434f8c9b330b31b6b5b5b0c6a15aa0b12de8ffe033c4908939a5",
      name: "Magic Eraser"
    },
    
    // AI Avatar Creator
    avatarCreator: {
      id: "lucataco/avatar-ai:0d81c9c19d2c4c0a8c6a0e0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0",
      name: "AI Avatar Creator"
    },
    
    // Text to Image
    textToImage: {
      id: "stability-ai/stable-diffusion:27b93a2413e7f36cd83da926f3656280b2931564ff050bf9575f1fdf9bcd7478",
      name: "Text to Image"
    },
    
    // Image Upscale
    imageUpscale: {
      id: "nightmareai/real-esrgan:42fed1c4974146d4d2414e2be2c5277c7fcf05fcc3a73abf41610695738c1d7b",
      name: "Image Upscale"
    },
    
    // Style Transfer Base Model
    styleTransfer: {
      id: "lucataco/sdxl-lightning-4step:727e49a643e999d962a5a7c9b5cdf92ea7f63badacf55a5b4d5613b55b1f7c24",
      name: "Style Transfer"
    },
    
    // Mockup/Fine Tune
    mockupGenerator: {
      id: "lucataco/modnet:7e6c9b3c062217ce6bb0e0cf1e8c57e35b5d1e2678e2847b1e4b2c3203045b3f",
      name: "Mockup Generator"
    }
  }
};*/