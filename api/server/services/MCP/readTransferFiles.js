const { logger } = require('@librechat/data-schemas');
const { getStrategyFunctions } = require('~/server/services/Files/strategies');
const db = require('~/models');

const MAX_BYTES = 20 * 1024 * 1024;

async function readStream(stream) {
  const chunks = [];
  let total = 0;
  for await (const chunk of stream) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > MAX_BYTES) {
      throw new Error('Attached file is too large to send.');
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

/**
 * Bytes of the person's own files, for an MCP server that receives them out of band.
 * A file that is missing or belongs to someone else is left out; the caller reports that.
 *
 * @param {{ userId: string, fileIds: string[], req: { config?: object, user?: object } }} options
 * @returns {Promise<Map<string, { id: string, name?: string, mimeType: string, bytes: Buffer }>>}
 */
async function readTransferFiles({ userId, fileIds, req }) {
  const files = new Map();
  if (!userId || !req) {
    return files;
  }
  for (const fileId of fileIds) {
    const record = await db.findFileById(fileId);
    if (!record || String(record.user) !== String(userId)) {
      continue;
    }
    try {
      const { getDownloadStream } = getStrategyFunctions(record.source);
      if (typeof getDownloadStream !== 'function') {
        continue;
      }
      const stream = await getDownloadStream(req, record.filepath);
      const bytes = await readStream(stream);
      files.set(fileId, {
        id: fileId,
        name: record.filename,
        mimeType: record.type || 'application/octet-stream',
        bytes,
      });
    } catch (error) {
      logger.warn('[MCP][readTransferFiles] Could not read an attachment', {
        fileId,
        error,
      });
    }
  }
  return files;
}

module.exports = { readTransferFiles };
