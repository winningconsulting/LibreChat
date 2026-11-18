import type { FileContext, FileSources } from 'librechat-data-provider';
import type { ValidatedResourceBlob } from './files';
import type { StoredResourceFile } from '../types';

export const STORED_FILES_ARTIFACT_KEY = 'stored_files' as const;

export type ResourceBlobPersistContext = {
  userId: string;
  tenantId?: string;
  conversationId?: string;
  messageId?: string;
  toolCallId?: string;
  context?: FileContext;
  /**
   * Minimal Express request surface for storage strategies (user + app config).
   * Typed loosely so packages/api stays free of Express types.
   */
  req: {
    user: { id: string; tenantId?: string; role?: string };
    config: {
      fileStrategy?: FileSources | string;
      paths?: Record<string, string>;
      [key: string]: unknown;
    };
  };
};

export type PersistResourceBlobs = (
  resources: ValidatedResourceBlob[],
  context: ResourceBlobPersistContext,
) => Promise<StoredResourceFile[]>;
