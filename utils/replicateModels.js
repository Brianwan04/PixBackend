// utils/replicateModels.js
module.exports = {
  models: {
    backgroundRemover: {
      id: "851-labs/background-remover:a029dff38972b5fda4ec5d75d7d1cd25aeff621d2cf4946a41055d7db66b80bc",
      name: "Background Remover"
    },
    aiEnhancer: {
      id: "tencentarc/vqfr:f9085ea5bf9c8f2d7e5c64564234ab41b5bcd8cd61a58b59a3dde5cbb487721a",
      name: "VQFR Enhancer"
    },
    avatarCreator: {
      id: "bytedance/pulid:43d309c37ab4e62361e5e29b8e9e867fb2dcbcec77ae91206a8d95ac5dd451a0",
      name: "Pulid Avatar"
    },
    textToImage: {
      id: "bytedance/sdxl-lightning-4step:6f7a773af6fc3e8de9d5a3c00be77c17308914bf67772726aff83496ba1e3bbe",
      name: "SDXL Lightning"
    },
    imageUpscale: {
      id: "tencentarc/gfpgan:9283608cc6b7be6b65a8e44983db012355fde4132009bf99d9761b0068f7479b",
      name: "GFP-GAN Upscale"
      //id: "sczhou/codeformer:7de2ea26c616d5bf2245ad0d5e24f0ff9a6204578a5c876db53142edd9d2cd56",
     // name: "CodeFormer Upscale"
    },
    aiArt: {
      id: "fofr/become-image:8c00cf0b5c99a4eabeddedb2921536b66db4e282acf7c83eaee42a3d5d5f3c29",
      name: "Become Image"
    },
    bgGenerator: {
      id: "briaai/rmbg-1.4:4e3da974d0f0909e31d45edb0b76925dd5f927b914a1e53d3d1e6fa43f1c397c",
      name: "Bria Background Generator"
    },
    // placeholders for models you didn't pin — add versions later
    magicEraser: { id: "stability-ai/stable-diffusion-inpainting:95a366c6de1b434f8c9b330b31b6b5b5b0c6a15aa0b12de8ffe033c4908939a5", name: "Inpainting (placeholder)" },
    styleTransfer: { id: "stability-ai/stable-diffusion:27b93a2413e7f36cd83da926f3656280b2931564ff050bf9575f1fdf9bcd7478", name: "Style Transfer (placeholder)" },
    mockupGenerator: { id: "mia/mockup-placeholder:latest", name: "Mockup (placeholder)" }
  }
};
