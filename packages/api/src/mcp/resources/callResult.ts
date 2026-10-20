import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import type { FormattedContentResult, MCPToolCallResponse, Provider } from '../types';
import {
  STORED_FILES_ARTIFACT_KEY,
  type PersistResourceBlobs,
  type ResourceBlobPersistContext,
} from './persist';
import { extractAndValidateResourceBlobs } from './files';

export type FormatToolContentFn = (
  result: MCPToolCallResponse,
  provider: Provider,
  metadata?: unknown,
) => FormattedContentResult;

/**
 * Formats an MCP tool result, optionally validating and persisting embedded
 * resource blobs before they reach the model path.
 */
export async function formatToolResultWithOptionalBlobPersistence({
  toolResult,
  provider,
  formatMetadata,
  shouldPersistBlobs,
  persistResourceBlobs,
  resourcePersistContext,
  userId,
  tenantId,
  errorPrefix,
  formatToolContent,
}: {
  toolResult: MCPToolCallResponse;
  provider: Provider;
  formatMetadata?: Record<string, unknown>;
  shouldPersistBlobs: boolean;
  persistResourceBlobs?: PersistResourceBlobs;
  resourcePersistContext?: Omit<ResourceBlobPersistContext, 'userId' | 'tenantId'>;
  userId?: string;
  tenantId?: string;
  errorPrefix: string;
  formatToolContent: FormatToolContentFn;
}): Promise<FormattedContentResult> {
  if (!shouldPersistBlobs || typeof persistResourceBlobs !== 'function') {
    return formatToolContent(toolResult, provider, formatMetadata);
  }

  const { resources, content: cleanedContent } = extractAndValidateResourceBlobs(
    toolResult?.content,
  );
  const cleanedResult: MCPToolCallResponse = {
    ...toolResult,
    content: cleanedContent,
  };
  const [text, artifacts] = formatToolContent(cleanedResult, provider, formatMetadata);

  if (!resources.length) {
    return [text, artifacts];
  }

  if (!userId || !resourcePersistContext?.req) {
    throw new McpError(
      ErrorCode.InvalidRequest,
      `${errorPrefix} persistResourceBlobs requires an authenticated user and request context.`,
    );
  }

  const storedFiles = await persistResourceBlobs(resources, {
    ...resourcePersistContext,
    userId,
    tenantId,
  });

  return [
    text,
    {
      ...artifacts,
      [STORED_FILES_ARTIFACT_KEY]: storedFiles,
    },
  ];
}
