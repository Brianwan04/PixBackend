const { formidable } = require('formidable');
const path = require('path');
const fs = require('fs').promises;

const UPLOAD_DIR = path.join(__dirname, '../../temp/uploads');

// Initialize upload directory
(async () => {
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  console.log('[ManualUpload] Directory initialized:', UPLOAD_DIR);
})();

const manualUpload = (req, res, next) => {
  const form = formidable({
    uploadDir: UPLOAD_DIR,
    keepExtensions: true,
    maxFileSize: 50 * 1024 * 1024, // 50MB
    maxFieldsSize: 100 * 1024 * 1024,
    multiples: true,
  });

  form.parse(req, (err, fields, files) => {
    if (err) {
      console.error('[ManualUpload] Parse error:', err.message);
      return res.status(500).json({ error: 'Upload failed', message: err.message });
    }

    // Normalize fields (formidable v3 returns arrays)
    req.body = {};
    Object.keys(fields).forEach(key => {
      const value = fields[key];
      req.body[key] = Array.isArray(value) ? value[0] : value;
    });

    // Normalize files → req.files (array, Multer-like)
    req.files = [];
    const fileList = files.images || [];
    (Array.isArray(fileList) ? fileList : [fileList]).forEach(file => {
      if (file && file.filepath) {
        req.files.push({
          fieldname: 'images',
          originalname: file.originalFilename || path.basename(file.filepath),
          path: file.filepath,
          mimetype: file.mimetype || 'image/jpeg',
          size: file.size,
        });
      }
    });

    console.log('[ManualUpload] Success:', req.files.length, 'files');
    console.log('Files:', req.files.map(f => f.originalname));
    console.log('Body:', req.body);

    next();
  });
};

module.exports = { manualUpload };