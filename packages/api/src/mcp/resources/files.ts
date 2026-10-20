import path from 'node:path';
import type {
  AudioContent,
  EmbeddedResource,
  ImageContent,
  ResourceLink,
  TextContent,
} from '@modelcontextprotocol/sdk/types.js';
import {
  isConversationAttachmentMimeTypeAllowed,
  normalizeAttachmentMimeType,
  resolveConversationAttachmentPolicy,
  type ConversationAttachmentPolicy,
} from '~/files/admission';

/** Local union so this module does not import `../types` (avoids a cycle via persist). */
type ToolContentPart = TextContent | ImageContent | EmbeddedResource | ResourceLink | AudioContent;

export type ResourceBlobValidationOptions = {
  /** Raw `fileConfig` from app config (same source as upload admission). */
  fileConfig?: unknown;
  endpoint?: string | null;
  endpointType?: string | null;
};

export type ValidatedResourceBlob = {
  filename: string;
  mimeType: string;
  buffer: Buffer;
  uri: string;
};

export type ExtractResourceBlobsResult = {
  resources: ValidatedResourceBlob[];
  content: ToolContentPart[];
};

export class MCPResourceBlobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MCPResourceBlobError';
  }
}

function getBase64Padding(data: string): number {
  if (data.endsWith('==')) {
    return 2;
  }
  if (data.endsWith('=')) {
    return 1;
  }
  return 0;
}

function estimateBase64Bytes(data: string): number {
  const padding = getBase64Padding(data);
  return Math.max(0, Math.floor((data.length * 3) / 4) - padding);
}

function isEmbeddedResource(item: ToolContentPart): item is EmbeddedResource {
  return item.type === 'resource';
}

function hasBlob(
  resource: EmbeddedResource['resource'],
): resource is EmbeddedResource['resource'] & { blob: string } {
  return 'blob' in resource && typeof resource.blob === 'string' && resource.blob.length > 0;
}

function filenameFromUri(uri: string): string {
  try {
    const parsed = new URL(uri);
    const segments = parsed.pathname.split('/').filter(Boolean);
    const leaf = segments[segments.length - 1] ?? '';
    return decodeURIComponent(leaf);
  } catch {
    const segments = uri.split('/').filter(Boolean);
    const leaf = segments[segments.length - 1] ?? '';
    try {
      return decodeURIComponent(leaf);
    } catch {
      return leaf;
    }
  }
}

function assertSafeFilename(filename: string): void {
  if (!filename || filename === '.' || filename === '..') {
    throw new MCPResourceBlobError('MCP resource blob filename is missing or invalid');
  }

  if (
    filename.includes('/') ||
    filename.includes('\\') ||
    filename.includes('\0') ||
    filename.includes('..')
  ) {
    throw new MCPResourceBlobError('MCP resource blob filename must not contain path segments');
  }

  if (path.basename(filename) !== filename) {
    throw new MCPResourceBlobError('MCP resource blob filename must be a single path segment');
  }
}

function resolvePolicy(options?: ResourceBlobValidationOptions): ConversationAttachmentPolicy {
  return resolveConversationAttachmentPolicy(options?.fileConfig, {
    endpoint: options?.endpoint,
    endpointType: options?.endpointType,
  });
}

function validateResourceBlob(
  item: EmbeddedResource,
  policy: ConversationAttachmentPolicy,
): ValidatedResourceBlob {
  const { resource } = item;
  if (!hasBlob(resource)) {
    throw new MCPResourceBlobError('MCP resource is missing a blob');
  }

  if (!resource.uri || typeof resource.uri !== 'string') {
    throw new MCPResourceBlobError('MCP resource blob is missing a URI');
  }

  if (resource.uri.startsWith('ui://')) {
    throw new MCPResourceBlobError('UI resources cannot be persisted as file attachments');
  }

  const mimeTypeRaw = resource.mimeType;
  if (!mimeTypeRaw || typeof mimeTypeRaw !== 'string') {
    throw new MCPResourceBlobError('MCP resource blob is missing a MIME type');
  }

  const filename = filenameFromUri(resource.uri);
  assertSafeFilename(filename);

  const mimeType = normalizeAttachmentMimeType(filename, mimeTypeRaw);
  if (!isConversationAttachmentMimeTypeAllowed(mimeType, policy.supportedMimeTypes)) {
    throw new MCPResourceBlobError(
      `MCP resource blob MIME type is not allowed for conversation attachments: ${mimeType}`,
    );
  }

  const maxBytes = policy.fileSizeLimit;
  const estimatedBytes = estimateBase64Bytes(resource.blob);
  if (estimatedBytes > maxBytes) {
    throw new MCPResourceBlobError(
      `MCP resource blob exceeds maximum size of ${maxBytes} bytes: ${estimatedBytes} bytes`,
    );
  }

  let buffer: Buffer;
  try {
    buffer = Buffer.from(resource.blob, 'base64');
  } catch {
    throw new MCPResourceBlobError('MCP resource blob is not valid base64');
  }

  if (buffer.length === 0) {
    throw new MCPResourceBlobError('MCP resource blob decoded to an empty file');
  }

  if (buffer.length > maxBytes) {
    throw new MCPResourceBlobError(
      `MCP resource blob exceeds maximum size of ${maxBytes} bytes: ${buffer.length} bytes`,
    );
  }

  return {
    filename,
    mimeType,
    buffer,
    uri: resource.uri,
  };
}

/**
 * Extracts opted-in MCP embedded resource blobs, validates them with the same
 * conversation-attachment `fileConfig` rules as uploads, and returns tool content
 * with those resource parts removed so base64 never reaches the model.
 */
export function extractAndValidateResourceBlobs(
  content: ToolContentPart[] | undefined,
  options?: ResourceBlobValidationOptions,
): ExtractResourceBlobsResult {
  const parts = content ?? [];
  const resources: ValidatedResourceBlob[] = [];
  const kept: ToolContentPart[] = [];
  const policy = resolvePolicy(options);
  const maxFiles = policy.fileLimit;

  for (const item of parts) {
    if (!isEmbeddedResource(item) || !hasBlob(item.resource)) {
      kept.push(item);
      continue;
    }

    if (item.resource.uri?.startsWith('ui://')) {
      kept.push(item);
      continue;
    }

    if (resources.length >= maxFiles) {
      throw new MCPResourceBlobError(
        `MCP tool result exceeds maximum of ${maxFiles} resource blobs`,
      );
    }

    resources.push(validateResourceBlob(item, policy));
  }

  return { resources, content: kept };
}
