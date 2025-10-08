// utils/fileCleanup.js
const fs = require('fs').promises;
const path = require('path');
const cron = require('node-cron');

const UPLOAD_DIR = path.join(__dirname, '..', 'temp', 'uploads');
const PROCESSED_DIR = path.join(__dirname, '..', 'public', 'processed');

const DIRS = [UPLOAD_DIR, PROCESSED_DIR];

const RETENTION_HOURS = Number(process.env.FILE_RETENTION_HOURS) || 1; // default 1 hour
const RETENTION_MS = RETENTION_HOURS * 60 * 60 * 1000;

/**
 * Delete files in a directory older than retentionMs
 */
async function cleanDir(dir, retentionMs) {
  try {
    const files = await fs.readdir(dir);
    const now = Date.now();

    await Promise.all(files.map(async (file) => {
      try {
        const filePath = path.join(dir, file);
        const stat = await fs.stat(filePath);

        // If it's a file and older than retention
        if (stat.isFile() && (now - stat.mtimeMs) > retentionMs) {
          await fs.unlink(filePath);
          console.log(`Deleted old file: ${filePath}`);
        }
      } catch (err) {
        // ignore individual file errors but log them
        console.error(`Error handling file ${file} in ${dir}:`, err.message);
      }
    }));
  } catch (err) {
    // Directory might not exist yet — create it or log
    if (err.code === 'ENOENT') {
      console.log(`Directory not found, creating: ${dir}`);
      await fs.mkdir(dir, { recursive: true });
    } else {
      console.error(`Failed to read dir ${dir}:`, err);
    }
  }
}

/**
 * Run cleanup immediately (useful for testing)
 */
async function cleanupOldFiles() {
  console.log(`Running cleanup. Retention: ${RETENTION_HOURS} hour(s).`);
  await Promise.all(DIRS.map(dir => cleanDir(dir, RETENTION_MS)));
}

/**
 * Schedule periodic cleanup using node-cron
 * Default: run at minute 0 every hour -> '0 * * * *'
 * You can override cron schedule via CLEANUP_CRON env var
 */
function scheduleCleanup() {
  if (process.env.DISABLE_CLEANUP === 'true') {
    console.log('File cleanup disabled via DISABLE_CLEANUP=true');
    return;
  }

  const cronExpr = process.env.CLEANUP_CRON || '0 * * * *'; // hourly
  try {
    // schedule
    cron.schedule(cronExpr, () => {
      cleanupOldFiles().catch(err => console.error('Scheduled cleanup error:', err));
    }, {
      scheduled: true,
      timezone: process.env.CLEANUP_TZ || 'UTC'
    });

    // run once at startup
    cleanupOldFiles().catch(err => console.error('Initial cleanup error:', err));
    console.log(`Scheduled file cleanup with cron expression "${cronExpr}" (retention: ${RETENTION_HOURS}h).`);
  } catch (err) {
    console.error('Failed to schedule cleanup:', err);
  }
}

module.exports = {
  scheduleCleanup,
  cleanupOldFiles, // export optional helper for manual triggering/testing
};
