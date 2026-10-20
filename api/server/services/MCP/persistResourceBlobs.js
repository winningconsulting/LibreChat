const { v4: uuidv4 } = require('uuid');
const { logger } = require('@librechat/data-schemas');
const { FileContext, FileSources } = require('librechat-data-provider');
const { getStorageMetadata, sanitizeFilename } = require('@librechat/api');
const { getStrategyFunctions } = require('~/server/services/Files/strategies');
const { getRetentionExpiry } = require('~/server/services/Files/retention');
const db = require('~/models');

/**
 * Persists validated MCP resource blobs with the configured file strategy.
 * Rolls back every file from the same tool call if any save fails.
 *
 * @param {import('@librechat/api').ValidatedResourceBlob[]} resources
 * @param {import('@librechat/api').ResourceBlobPersistContext} context
 * @returns {Promise<import('@librechat/api').StoredResourceFile[]>}
 */
async function persistResourceBlobs(resources, context) {
  if (!resources?.length) {
    return [];
  }

  const { req, userId, tenantId, conversationId, messageId, toolCallId } = context;
  const appConfig = req?.config;
  const source = appConfig?.fileStrategy ?? FileSources.local;
  const { saveBuffer, deleteFile } = getStrategyFunctions(source);

  if (typeof saveBuffer !== 'function') {
    throw new Error(`saveBuffer is not available for file strategy "${source}"`);
  }

  /** @type {import('@librechat/api').StoredResourceFile[]} */
  const saved = [];

  try {
    for (const resource of resources) {
      const file_id = uuidv4();
      const safeName = sanitizeFilename(resource.filename);
      const fileName = `${file_id}__${safeName}`;
      const filepath = await saveBuffer({
        userId,
        buffer: resource.buffer,
        fileName,
        basePath: 'uploads',
        tenantId,
      });
      const storageMetadata = getStorageMetadata({
        filepath,
        source,
      });
      const retentionExpiry = await getRetentionExpiry(req);
      const file = await db.createFile(
        {
          user: userId,
          file_id,
          bytes: resource.buffer.length,
          filepath,
          ...storageMetadata,
          filename: safeName,
          type: resource.mimeType,
          object: 'file',
          embedded: false,
          source,
          context: context.context ?? FileContext.message_attachment,
          conversationId,
          messageId,
          tenantId,
          usage: 0,
          ...retentionExpiry,
        },
        true,
      );

      saved.push({
        file_id: file.file_id ?? file_id,
        filename: file.filename ?? safeName,
        filepath: file.filepath ?? filepath,
        type: file.type ?? resource.mimeType,
        bytes: file.bytes ?? resource.buffer.length,
        embedded: false,
        object: 'file',
        user: userId,
        source: file.source ?? source,
        context: file.context ?? FileContext.message_attachment,
        tenantId: file.tenantId ?? tenantId,
        conversationId: file.conversationId ?? conversationId,
        messageId: file.messageId ?? messageId,
        toolCallId,
        storageKey: file.storageKey ?? storageMetadata.storageKey,
        storageRegion: file.storageRegion ?? storageMetadata.storageRegion,
        expiresAt: file.expiresAt ?? file.expiredAt,
      });
    }

    return saved;
  } catch (error) {
    logger.error('[MCP][persistResourceBlobs] Failed to persist resource blobs, rolling back', {
      error,
      savedCount: saved.length,
    });

    for (const file of saved) {
      try {
        if (typeof deleteFile === 'function') {
          await deleteFile(req, file);
        }
      } catch (deleteError) {
        logger.warn('[MCP][persistResourceBlobs] Failed to delete stored file during rollback', {
          file_id: file.file_id,
          error: deleteError,
        });
      }

      try {
        await db.deleteFiles([file.file_id]);
      } catch (dbError) {
        logger.warn('[MCP][persistResourceBlobs] Failed to delete file metadata during rollback', {
          file_id: file.file_id,
          error: dbError,
        });
      }
    }

    throw error;
  }
}

module.exports = {
  persistResourceBlobs,
};
