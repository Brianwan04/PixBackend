// utils/replicateModels.js
module.exports = {
  models: {
    backgroundRemover: {
      id: "851-labs/background-remover:a029dff38972b5fda4ec5d75d7d1cd25aeff621d2cf4946a41055d7db66b80bc",
      name: "Background Remover"
    },
    aiEnhancer: {
      //id: "tencentarc/vqfr:f9085ea5bf9c8f2d7e5c64564234ab41b5bcd8cd61a58b59a3dde5cbb487721a",
     // name: "VQFR Enhancer"
      id: "codeslake/ifan-defocus-deblur:ea3b2e163e2ad629fb23e81a1cc9e485c32aa4a53eba4fe08b7dbdd39e6e381e",
      name: "AI Enhancer"
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
      id: "tencentarc/gfpgan:0fbacf7afc6c144e5be9767cff80f25aff23e52b0708f17e20f9879b2f21516c",
      name: "GFP-GAN Upscale"
      //id: "sczhou/codeformer:7de2ea26c616d5bf2245ad0d5e24f0ff9a6204578a5c876db53142edd9d2cd56",
     // name: "CodeFormer Upscale"
    },
    aiArt: {
      id: "fofr/become-image:8d0b076a2aff3904dfcec3253c778e0310a68f78483c4699c7fd800f3051d2b3",
      name: "Become Image"
    },
    bgGenerator: {
      id: "bria/generate-background",
      name: "Bria Background Generator"
    },
    // placeholders for models you didn't pin — add versions later
    magicEraser: { id: "stability-ai/stable-diffusion-inpainting:95a366c6de1b434f8c9b330b31b6b5b5b0c6a15aa0b12de8ffe033c4908939a5", name: "Inpainting (placeholder)" },
    styleTransfer: { id: "stability-ai/stable-diffusion:27b93a2413e7f36cd83da926f3656280b2931564ff050bf9575f1fdf9bcd7478", name: "Style Transfer (placeholder)" },
    mockupGenerator: { id: "mia/mockup-placeholder:latest", name: "Mockup (placeholder)" }
  }
};
