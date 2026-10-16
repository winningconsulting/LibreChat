import path from 'node:path';
import type { EmbeddedResource, ToolContentPart } from '../types';

export const DEFAULT_MCP_RESOURCE_BLOB_MAX_BYTES: number = 25 * 1024 * 1024;
export const DEFAULT_MCP_RESOURCE_BLOB_MAX_FILES: number = 10;

export const MCP_RESOURCE_MIME_EXTENSIONS: {
  readonly 'application/pdf': '.pdf';
  readonly 'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx';
  readonly 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx';
} = {
  'application/pdf': '.pdf',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
};

export type AllowedMCPResourceMimeType = keyof typeof MCP_RESOURCE_MIME_EXTENSIONS;

export type ValidatedResourceBlob = {
  filename: string;
  mimeType: AllowedMCPResourceMimeType;
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

function getMCPResourceBlobMaxBytes(): number {
  const raw = process.env.MCP_RESOURCE_BLOB_MAX_BYTES;
  if (!raw) {
    return DEFAULT_MCP_RESOURCE_BLOB_MAX_BYTES;
  }

  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0
    ? parsed
    : DEFAULT_MCP_RESOURCE_BLOB_MAX_BYTES;
}

function getMCPResourceBlobMaxFiles(): number {
  const raw = process.env.MCP_RESOURCE_BLOB_MAX_FILES;
  if (!raw) {
    return DEFAULT_MCP_RESOURCE_BLOB_MAX_FILES;
  }

  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0
    ? parsed
    : DEFAULT_MCP_RESOURCE_BLOB_MAX_FILES;
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

function assertMimeAndExtension(mimeType: string, filename: string): AllowedMCPResourceMimeType {
  if (!(mimeType in MCP_RESOURCE_MIME_EXTENSIONS)) {
    throw new MCPResourceBlobError(`MCP resource blob MIME type is not allowed: ${mimeType}`);
  }

  const allowed = mimeType as AllowedMCPResourceMimeType;
  const expectedExt = MCP_RESOURCE_MIME_EXTENSIONS[allowed];
  const actualExt = path.extname(filename).toLowerCase();
  if (actualExt !== expectedExt) {
    throw new MCPResourceBlobError(
      `MCP resource blob extension "${actualExt}" does not match MIME type "${mimeType}"`,
    );
  }

  return allowed;
}

function assertFileSignature(buffer: Buffer, mimeType: AllowedMCPResourceMimeType): void {
  if (mimeType === 'application/pdf') {
    if (buffer.length < 5 || buffer.subarray(0, 5).toString('utf8') !== '%PDF-') {
      throw new MCPResourceBlobError('MCP resource blob is not a valid PDF');
    }
    return;
  }

  const isZip =
    buffer.length >= 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    (buffer[2] === 0x03 || buffer[2] === 0x05 || buffer[2] === 0x07) &&
    (buffer[3] === 0x04 || buffer[3] === 0x06 || buffer[3] === 0x08);

  if (!isZip) {
    throw new MCPResourceBlobError('MCP resource blob is not a valid Office Open XML file');
  }
}

function validateResourceBlob(item: EmbeddedResource): ValidatedResourceBlob {
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
  const mimeType = assertMimeAndExtension(mimeTypeRaw, filename);

  const maxBytes = getMCPResourceBlobMaxBytes();
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

  assertFileSignature(buffer, mimeType);

  return {
    filename,
    mimeType,
    buffer,
    uri: resource.uri,
  };
}

/**
 * Extracts opted-in MCP embedded resource blobs, validates them, and returns
 * tool content with those resource parts removed so base64 never reaches the model.
 */
export function extractAndValidateResourceBlobs(
  content: ToolContentPart[] | undefined,
): ExtractResourceBlobsResult {
  const parts = content ?? [];
  const resources: ValidatedResourceBlob[] = [];
  const kept: ToolContentPart[] = [];
  const maxFiles = getMCPResourceBlobMaxFiles();

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

    resources.push(validateResourceBlob(item));
  }

  return { resources, content: kept };
}
