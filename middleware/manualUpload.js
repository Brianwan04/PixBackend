const formidable = require('formidable');
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
    maxFieldsSize: 100 * 1024 * 1024, // 100MB
    multiples: true, // Allow multiple files
  });

  form.parse(req, (err, fields, files) => {
    if (err) {
      console.error('[ManualUpload] Formidable error:', err.message);
      return res.status(500).json({ error: 'Upload failed', message: err.message });
    }

    // Convert fields to handle arrays correctly
    req.body = {};
    Object.keys(fields).forEach(key => {
      req.body[key] = Array.isArray(fields[key]) ? fields[key][0] : fields[key];
    });

    // Convert files to Multer-like format for compatibility
    req.files = [];
    Object.values(files).forEach(fileArray => {
      if (Array.isArray(fileArray)) {
        fileArray.forEach(file => {
          req.files.push({
            fieldname: 'images', // Force fieldname to match frontend
            originalname: file.originalFilename || file.newFilename,
            path: file.filepath,
            mimetype: file.mimetype || 'image/jpeg',
            size: file.size,
          });
        });
      } else {
        req.files.push({
          fieldname: 'images',
          originalname: fileArray.originalFilename || fileArray.newFilename,
          path: fileArray.filepath,
          mimetype: fileArray.mimetype || 'image/jpeg',
          size: fileArray.size,
        });
      }
    });

    console.log('[ManualUpload] Success:', req.files.length, 'files');
    console.log('Files:', req.files.map(f => ({ fieldname: f.fieldname, originalname: f.originalname })));
    console.log('Body:', req.body);

    next();
  });
};

module.exports = { manualUpload };