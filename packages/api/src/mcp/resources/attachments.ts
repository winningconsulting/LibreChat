import { logger } from '@librechat/data-schemas';
import type { StoredResourceFile } from '../types';
import { STORED_FILES_ARTIFACT_KEY } from './persist';

export type StoredFileAttachment = StoredResourceFile & {
  messageId: string;
  toolCallId: string;
  conversationId?: string;
};

export function collectStoredFileAttachments({
  artifact,
  messageId,
  toolCallId,
  conversationId,
}: {
  artifact?: { [STORED_FILES_ARTIFACT_KEY]?: StoredResourceFile[] } | null;
  messageId: string;
  toolCallId: string;
  conversationId?: string;
}): StoredFileAttachment[] {
  const files = artifact?.[STORED_FILES_ARTIFACT_KEY];
  if (!files?.length) {
    return [];
  }

  return files.map((file) => ({
    ...file,
    messageId,
    toolCallId,
    conversationId: conversationId ?? file.conversationId,
  }));
}

/**
 * Queues already-persisted MCP resource files as stream attachments.
 * Storage happened in the MCP tool pipeline; this only emits metadata.
 */
export function enqueueStoredFileAttachments({
  artifact,
  messageId,
  toolCallId,
  conversationId,
  artifactPromises,
  emit,
  shouldEmit,
}: {
  artifact?: { [STORED_FILES_ARTIFACT_KEY]?: StoredResourceFile[] } | null;
  messageId: string;
  toolCallId: string;
  conversationId?: string;
  artifactPromises: Array<Promise<unknown>>;
  emit: (attachment: StoredFileAttachment) => void;
  shouldEmit: () => boolean;
}): void {
  const attachments = collectStoredFileAttachments({
    artifact,
    messageId,
    toolCallId,
    conversationId,
  });

  for (const attachment of attachments) {
    artifactPromises.push(
      (async () => {
        if (shouldEmit()) {
          emit(attachment);
        }
        return attachment;
      })().catch((error: unknown) => {
        logger.error('Error emitting stored MCP resource attachment:', error);
        return null;
      }),
    );
  }
}
