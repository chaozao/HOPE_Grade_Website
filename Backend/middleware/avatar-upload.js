const multer = require('multer');
const fs = require('fs');
const path = require('path');

module.exports = function createAvatarUpload(directory) {
  const upload = multer({
    storage: multer.diskStorage({
      destination(req, file, done) {
        // Recreate a missing upload directory without preventing API startup.
        fs.mkdir(directory, { recursive: true }, (error) => done(error, directory));
      },
      filename(req, file, done) {
        done(null, req.user.userId + '-' + Date.now() + path.extname(file.originalname));
      }
    }),
    limits: { fileSize: 25 * 1024 * 1024 },
    fileFilter(req, file, done) {
      if (!file.mimetype.startsWith('image/')) {
        return done(Object.assign(new Error('Only image files are allowed.'), { code: 'IMAGE_REQUIRED' }));
      }
      done(null, true);
    }
  }).single('photo');

  return function avatarUpload(req, res, next) {
    upload(req, res, (error) => {
      if (!error) return next();
      if (error.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'Choose a photo 25 MB or smaller.' });
      }
      if (error.code === 'IMAGE_REQUIRED') {
        return res.status(400).json({ error: 'Only image files are allowed.' });
      }
      if (error instanceof multer.MulterError || /boundary|unexpected end/i.test(error.message)) {
        return res.status(400).json({ error: 'The photo upload was incomplete or invalid. Select the photo and try again.' });
      }
      // Do not log request data, tokens, or filesystem paths.
      const code = ['EACCES', 'EPERM', 'EROFS', 'ENOSPC', 'EDQUOT', 'ENOENT', 'ENOTDIR'].includes(error.code)
        ? error.code : 'UPLOAD_FAILED';
      console.error('[photo-upload]', code);
      return res.status(503).json({
        error: 'Photo storage is unavailable. Ask the administrator to check the hosting upload folder.',
        code
      });
    });
  };
};
