import type { FileContext, FileSources, TFile } from 'librechat-data-provider';
import type { ValidatedResourceBlob } from './files';

export const STORED_FILES_ARTIFACT_KEY: 'stored_files' = 'stored_files';

export type StoredResourceFile = Pick<
  TFile,
  | 'file_id'
  | 'filename'
  | 'filepath'
  | 'type'
  | 'bytes'
  | 'embedded'
  | 'object'
  | 'user'
  | 'source'
  | 'context'
> & {
  tenantId?: string;
  conversationId?: string;
  messageId?: string;
  toolCallId?: string;
  storageKey?: string;
  storageRegion?: string;
  filterSource?: FileSources;
  expiresAt?: string | Date;
};

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
