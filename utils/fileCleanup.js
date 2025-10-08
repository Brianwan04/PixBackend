const fs = require('fs').promises;
const path = require('path');
const cron = require('node-cron');

const UPLOAD_DIR = path.join(__dirname, '..', 'temp', 'uploads');
const PROCESSED_DIR = path.join(__dirname, '..', 'public', 'processed');
const DIRECTORIES = [UPLOAD_DIR, PROCESSED_DIR];

const RETENTION_HOURS = parseInt(process.env.FILE_RETENTION_HOURS, 10) || 1;
const RETENTION_MS = RETENTION_HOURS * 60 * 60 * 1000;

/**
 * Cleans files older than the retention period from a directory.
 * @param {string} dir - Directory to clean
 */
const cleanDirectory = async (dir) => {
  try {
    const files = await fs.readdir(dir, { withFileTypes: true });
    const now = Date.now();

    await Promise.all(files.map(async (file) => {
      if (file.isFile()) {
        const filePath = path.join(dir, file.name);
        const stats = await fs.stat(filePath);
        if ((now - stats.mtimeMs) > RETENTION_MS) {
          await fs.unlink(filePath);
          console.log(`[Cleanup] Removed old file: ${filePath}`);
        }
      }
    }));
  } catch (error) {
    if (error.code === 'ENOENT') {
      await fs.mkdir(dir, { recursive: true });
      console.log(`[Cleanup] Created missing directory: ${dir}`);
    } else {
      console.error(`[Cleanup] Error in ${dir}: ${error.message}`);
    }
  }
};

/**
 * Performs a full cleanup across all directories.
 */
const performCleanup = async () => {
  console.log(`[Cleanup] Starting with retention: ${RETENTION_HOURS} hours`);
  await Promise.all(DIRECTORIES.map(dir => cleanDirectory(dir)));
  console.log('[Cleanup] Completed');
};

/**
 * Schedules periodic cleanup.
 */
const scheduleCleanup = () => {
  if (process.env.DISABLE_CLEANUP === 'true') {
    console.log('[Cleanup] Disabled via DISABLE_CLEANUP=true');
    return;
  }

  const cronSchedule = process.env.CLEANUP_CRON || '0 0 * * *'; // Daily at midnight UTC
  const timezone = process.env.CLEANUP_TZ || 'UTC';

  try {
    cron.schedule(cronSchedule, performCleanup, { scheduled: true, timezone });
    performCleanup(); // Run on startup
    console.log(`[Cleanup] Scheduled with ${cronSchedule} (timezone: ${timezone}, retention: ${RETENTION_HOURS}h)`);
  } catch (error) {
    console.error(`[Cleanup] Scheduling failed: ${error.message}`);
  }
};

/**
 * Middleware to track files for cleanup after processing.
 * @param {string} filePath - Path to the file to track
 * @returns {Function} Middleware function
 */
const trackFileForCleanup = (filePath) => (req, res, next) => {
  if (!req.filesToCleanup) {
    req.filesToCleanup = [];
  }
  req.filesToCleanup.push(filePath);
  next();
};

/**
 * Cleanup tracked files after response is sent.
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const cleanupTrackedFiles = (req, res, next) => {
  if (req.filesToCleanup) {
    req.filesToCleanup.forEach(async (filePath) => {
      try {
        await fs.unlink(filePath);
        console.log(`[Cleanup] Removed tracked file: ${filePath}`);
      } catch (error) {
        console.error(`[Cleanup] Failed to remove ${filePath}: ${error.message}`);
      }
    });
    delete req.filesToCleanup; // Clean up the array after processing
  }
  next();
};

module.exports = { scheduleCleanup, performCleanup, trackFileForCleanup, cleanupTrackedFiles };