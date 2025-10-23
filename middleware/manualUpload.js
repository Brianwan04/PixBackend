const formidable = require('formidable');
const path = require('path');
const fs = require('fs').promises;

const UPLOAD_DIR = path.join(__dirname, '../../temp/uploads');

// Initialize directory
(async () => {
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
})();

const manualUpload = (req, res, next) => {
  const form = formidable({
    uploadDir: UPLOAD_DIR,
    keepExtensions: true,
    maxFileSize: 50 * 1024 * 1024, // 50MB
    maxFieldsSize: 100 * 1024 * 1024, // 100MB
    multiples: true,
    // ✅ ACCEPTS ANY FIELD NAME
  });

  form.parse(req, (err, fields, files) => {
    if (err) {
      console.error('Formidable error:', err);
      return res.status(500).json({ error: 'Upload failed' });
    }

    // Convert to multer-like format
    req.body = fields;
    req.files = [];
    
    // Handle multiple files from same fieldname
    Object.values(files).forEach(fileArray => {
      if (Array.isArray(fileArray)) {
        fileArray.forEach(file => {
          if (file.filepath) {
            req.files.push({
              fieldname: file.originalFilename ? 'images' : file.fieldname,
              originalname: file.originalFilename || file.filepath.split('/').pop(),
              path: file.filepath,
              mimetype: file.mimetype || 'image/jpeg',
              size: file.size
            });
          }
        });
      } else if (fileArray.filepath) {
        req.files.push({
          fieldname: fileArray.originalFilename ? 'images' : fileArray.fieldname,
          originalname: fileArray.originalFilename || fileArray.filepath.split('/').pop(),
          path: fileArray.filepath,
          mimetype: fileArray.mimetype || 'image/jpeg',
          size: fileArray.size
        });
      }
    });

    console.log('✅ MANUAL UPLOAD SUCCESS:', req.files.length, 'files');
    console.log('Files:', req.files.map(f => ({ fieldname: f.fieldname, originalname: f.originalname })));
    
    next();
  });
};

module.exports = { manualUpload };
