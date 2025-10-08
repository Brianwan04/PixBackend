const fs = require('fs').promises;
const path = require('path');
const cron = require('node-cron');

const UPLOAD_DIR = path.join(__dirname, '..', 'temp', 'uploads');
const PROCESSED_DIR = path.join(__dirname, '..', 'public', 'processed');
const DIRECTORIES = [UPLOAD_DIR, PROCESSED_DIR];

const RETENTION_HOURS = parseInt(process.env.FILE_RETENTION_HOURS, 10) || 1; // Default 1 hour
const RETENTION_MS = RETENTION_HOURS * 60 * 60 * 1000;

/**
 * Cleans a directory by removing files older than the retention period.
 * @param {string} dir - Directory path to clean
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
          console.log(`Cleaned up file: ${filePath}`);
        }
      }
    }));
  } catch (error) {
    if (error.code === 'ENOENT') {
      await fs.mkdir(dir, { recursive: true });
      console.log(`Created missing directory: ${dir}`);
    } else {
      console.error(`Error cleaning directory ${dir}: ${error.message}`);
    }
  }
};

/**
 * Executes a full cleanup across all monitored directories.
 */
const performCleanup = async () => {
  console.log(`Starting cleanup with retention of ${RETENTION_HOURS} hours...`);
  await Promise.all(DIRECTORIES.map(dir => cleanDirectory(dir)));
  console.log('Cleanup completed.');
};

/**
 * Schedules periodic cleanup using cron.
 */
const scheduleCleanup = () => {
  if (process.env.DISABLE_CLEANUP === 'true') {
    console.log('File cleanup disabled via DISABLE_CLEANUP=true');
    return;
  }

  const cronSchedule = process.env.CLEANUP_CRON || '0 0 * * *'; // Run daily at midnight UTC by default
  const timezone = process.env.CLEANUP_TZ || 'UTC';

  try {
    cron.schedule(cronSchedule, performCleanup, {
      scheduled: true,
      timezone
    });
    performCleanup(); // Run immediately on startup
    console.log(`Cleanup scheduled with cron: ${cronSchedule} (timezone: ${timezone}, retention: ${RETENTION_HOURS}h)`);
  } catch (error) {
    console.error(`Failed to schedule cleanup: ${error.message}`);
  }
};

module.exports = { scheduleCleanup, performCleanup };