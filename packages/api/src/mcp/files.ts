/**
 * Client side of the MCP file-transfer extension (`io.modelcontextprotocol/files`).
 *
 * Bytes move over HTTP, outside the tool arguments and the tool result. The model
 * keeps seeing attachment ids. This module swaps those ids for file metadata on the
 * wire, uploads when the server asks, and downloads what the result points at.
 */
import { createHash, randomBytes } from 'node:crypto';
import {
  MCP_RESOURCE_MIME_EXTENSIONS,
  type AllowedMCPResourceMimeType,
  type ValidatedResourceBlob,
} from './resources/files';

export const FILES_EXTENSION = 'io.modelcontextprotocol/files';

const FILE_ID_DESCRIPTION = 'Id of an attached file, from an Attached file line.';
const SEGMENT = /^[A-Za-z0-9._~-]+$/;

export type TransferFile = {
  id: string;
  name?: string;
  mimeType: string;
  bytes: Uint8Array;
};

export type JsonSchema = {
  type?: string;
  description?: string;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  required?: string[];
  'x-mcp-file'?: unknown;
  [key: string]: unknown;
};

type UploadTarget = {
  fileId: string;
  url?: string;
  path?: string;
  method?: 'PUT' | 'POST';
  headers?: Record<string, string>;
  credentials: 'omit' | 'include';
  form?: { fields: { name: string; value: string }[]; fileField: string };
};

type DownloadTarget = {
  name?: string;
  mimeType: string;
  size: number;
  url?: string;
  path?: string;
  headers?: Record<string, string>;
  credentials: 'omit' | 'include';
  digest?: { algorithm: 'sha-256'; value: string };
};

export type ToolCallResult = {
  content?: { type: string; text?: string }[];
  isError?: boolean;
  resultType?: string;
  uploads?: UploadTarget[];
  requestState?: string;
  _meta?: Record<string, unknown>;
  [key: string]: unknown;
};

export function fileTransferRequestMeta(): Record<string, unknown> {
  return {
    'io.modelcontextprotocol/clientCapabilities': {
      extensions: {
        [FILES_EXTENSION]: { upload: {}, download: {} },
      },
    },
  };
}

function isFileSchema(schema: JsonSchema | undefined): boolean {
  return !!schema && schema.type === 'object' && schema['x-mcp-file'] != null;
}

/** The schema the model sees: a file argument is the attachment id, not the bytes. */
export function presentFileArguments(schema: JsonSchema): JsonSchema {
  if (schema.type === 'array' && isFileSchema(schema.items)) {
    return {
      ...schema,
      items: { type: 'string', description: FILE_ID_DESCRIPTION },
    };
  }
  if (isFileSchema(schema)) {
    return { type: 'string', description: schema.description || FILE_ID_DESCRIPTION };
  }
  if (schema.type === 'object' && schema.properties) {
    const properties: Record<string, JsonSchema> = {};
    for (const [key, child] of Object.entries(schema.properties)) {
      properties[key] = presentFileArguments(child);
    }
    return { ...schema, properties };
  }
  return schema;
}

type FileSlot = { path: string[]; id: string };

function collectSlots(
  schema: JsonSchema | undefined,
  value: unknown,
  path: string[],
  out: FileSlot[],
) {
  if (!schema) {
    return;
  }
  if (schema.type === 'array' && isFileSchema(schema.items) && Array.isArray(value)) {
    value.forEach((item, index) => {
      if (typeof item === 'string' && item.trim()) {
        out.push({ path: [...path, String(index)], id: item.trim() });
      }
    });
    return;
  }
  if (isFileSchema(schema) && typeof value === 'string' && value.trim()) {
    out.push({ path, id: value.trim() });
    return;
  }
  if (schema.type === 'object' && schema.properties && value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const [key, child] of Object.entries(schema.properties)) {
      collectSlots(child, record[key], [...path, key], out);
    }
  }
}

function fileInput(file: TransferFile): Record<string, unknown> {
  const input: Record<string, unknown> = {
    id: file.id,
    mimeType: file.mimeType || 'application/octet-stream',
    size: file.bytes.byteLength,
  };
  if (file.name) {
    input.name = file.name;
  }
  return input;
}

function assign(root: Record<string, unknown>, path: string[], input: Record<string, unknown>) {
  if (path.length === 1 && !/^\d+$/.test(path[0])) {
    root[path[0]] = input;
    return;
  }
  const [head, ...rest] = path;
  if (rest.length === 0) {
    return;
  }
  const next = root[head];
  if (Array.isArray(next) && /^\d+$/.test(rest[0]) && rest.length === 1) {
    next[Number(rest[0])] = input;
  }
}

function argumentsWithFiles(
  toolArguments: Record<string, unknown>,
  slots: FileSlot[],
  files: Map<string, TransferFile>,
): Record<string, unknown> {
  const copy = structuredClone(toolArguments);
  for (const slot of slots) {
    const file = files.get(slot.id);
    if (!file) {
      continue;
    }
    assign(copy, slot.path, fileInput(file));
  }
  return copy;
}

function isLoopback(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]' ||
    hostname === '::1'
  );
}

export function resolveTransferUrl(
  mcpUrl: string,
  target: { url?: string; path?: string },
): string {
  if (target.url) {
    return target.url;
  }
  const base = new URL(mcpUrl);
  const prefix = base.pathname.endsWith('/') ? base.pathname.slice(0, -1) : base.pathname;
  base.pathname = `${prefix}${target.path ?? ''}`;
  return base.toString();
}

function validPath(path: string): boolean {
  if (!path.startsWith('/') || path.includes('//')) {
    return false;
  }
  const parts = path.split('/').slice(1);
  return (
    parts.length > 0 && parts.every((part) => part !== '.' && part !== '..' && SEGMENT.test(part))
  );
}

function assertTarget(
  target: { url?: string; path?: string; credentials?: string; headers?: Record<string, string> },
  mcpUrl: string,
) {
  const hasUrl = typeof target.url === 'string';
  const hasPath = typeof target.path === 'string';
  if (hasUrl === hasPath) {
    throw new Error('File transfer target is missing its address.');
  }
  if (hasPath && !validPath(target.path ?? '')) {
    throw new Error('File transfer path is not a safe path.');
  }
  if (hasUrl) {
    const url = new URL(target.url ?? '');
    if (url.username || url.password) {
      throw new Error('File transfer URL must not carry userinfo.');
    }
    const https = url.protocol === 'https:';
    const loopback = url.protocol === 'http:' && isLoopback(url.hostname);
    if (!https && !loopback) {
      throw new Error('File transfer URL must be https.');
    }
  }
  const headerNames = Object.keys(target.headers ?? {});
  if (headerNames.some((name) => /^(authorization|cookie)$/i.test(name))) {
    throw new Error('File transfer target must not set Authorization or Cookie.');
  }
  if (target.credentials === 'include') {
    const targetUrl = new URL(resolveTransferUrl(mcpUrl, target));
    const mcp = new URL(mcpUrl);
    if (targetUrl.origin !== mcp.origin) {
      throw new Error('File transfer credentials stay on the server origin.');
    }
  }
}

function quotePart(value: string): string {
  return value
    .replace(/%/g, '%25')
    .replace(/"/g, '%22')
    .replace(/\r/g, '%0D')
    .replace(/\n/g, '%0A');
}

function multipartBody(
  target: UploadTarget,
  file: TransferFile,
): { body: Buffer; contentType: string } {
  const boundary = `mcp${randomBytes(16).toString('hex')}`;
  const form = target.form!;
  const filename = quotePart((file.name ?? 'file').split(/[/\\]/).pop() || 'file');
  const chunks: Buffer[] = [];
  for (const field of form.fields) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${quotePart(field.name)}"\r\n\r\n${field.value}\r\n`,
      ),
    );
  }
  const mime = file.mimeType || 'application/octet-stream';
  chunks.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${quotePart(form.fileField)}"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`,
    ),
  );
  chunks.push(Buffer.from(file.bytes));
  chunks.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}

async function sendBytes(
  fetchImpl: typeof fetch,
  url: string,
  method: string,
  headers: Record<string, string>,
  body: Uint8Array,
  signal?: AbortSignal,
) {
  const response = await fetchImpl(url, {
    method,
    headers: { ...headers, 'Content-Length': String(body.byteLength) },
    body: Buffer.from(body),
    redirect: 'manual',
    signal,
  });
  if (response.status >= 300 && response.status < 400) {
    throw new Error('File transfer refused a redirect.');
  }
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`File transfer failed with HTTP ${response.status}.`);
  }
}

function downloadName(target: DownloadTarget): string {
  const ext = MCP_RESOURCE_MIME_EXTENSIONS[target.mimeType as AllowedMCPResourceMimeType];
  const leaf = (target.name ?? 'file').split(/[/\\]/).pop() ?? 'file';
  const clean = leaf.replace(/[^\w.-]+/g, '_').replace(/^\.+/, '') || 'file';
  if (!ext) {
    throw new Error(`File type ${target.mimeType} cannot be kept.`);
  }
  return clean.toLowerCase().endsWith(ext) ||
    (ext === '.jpg' && clean.toLowerCase().endsWith('.jpeg'))
    ? clean
    : `${clean}${ext}`;
}

async function readDownload(
  fetchImpl: typeof fetch,
  mcpUrl: string,
  target: DownloadTarget,
  signal?: AbortSignal,
): Promise<ValidatedResourceBlob> {
  assertTarget(target, mcpUrl);
  if (!Number.isInteger(target.size) || target.size < 0) {
    throw new Error('Download is missing its size.');
  }
  const url = resolveTransferUrl(mcpUrl, target);
  const response = await fetchImpl(url, {
    method: 'GET',
    headers: target.headers ?? {},
    redirect: 'manual',
    signal,
  });
  if (response.status >= 300 && response.status < 400) {
    throw new Error('File transfer refused a redirect.');
  }
  if (response.status !== 200 && response.status !== 206) {
    throw new Error(`File download failed with HTTP ${response.status}.`);
  }
  const announced = Number(response.headers.get('content-length'));
  if (Number.isFinite(announced) && announced > target.size) {
    throw new Error('Downloaded file is larger than declared.');
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length !== target.size) {
    throw new Error('Downloaded file size does not match.');
  }
  if (target.digest?.algorithm === 'sha-256') {
    const hash = createHash('sha256').update(buffer).digest('base64url');
    if (hash !== target.digest.value) {
      throw new Error('Downloaded file digest does not match.');
    }
  }
  const filename = downloadName(target);
  return {
    filename,
    mimeType: target.mimeType as AllowedMCPResourceMimeType,
    buffer,
    uri: `mcp-file://downloads/${filename}`,
  };
}

function downloadsOf(result: ToolCallResult): DownloadTarget[] {
  const meta = result._meta?.[FILES_EXTENSION];
  if (!meta || typeof meta !== 'object') {
    return [];
  }
  const downloads = (meta as { downloads?: DownloadTarget[] }).downloads;
  return Array.isArray(downloads) ? downloads : [];
}

function uploadOf(
  result: ToolCallResult,
): { uploads: UploadTarget[]; requestState: string } | undefined {
  if (result.resultType !== 'upload_required') {
    return undefined;
  }
  if (
    !Array.isArray(result.uploads) ||
    typeof result.requestState !== 'string' ||
    !result.requestState
  ) {
    throw new Error('Upload request is incomplete.');
  }
  return { uploads: result.uploads, requestState: result.requestState };
}

function failed(text: string): ToolCallResult {
  return { content: [{ type: 'text', text }], isError: true };
}

/**
 * Calls a tool that may receive and return files out of band.
 * `toolArguments` is not modified: the message keeps the ids the model sent.
 */
export async function callToolWithFileTransfers(options: {
  mcpUrl?: string;
  schema?: JsonSchema;
  toolArguments?: Record<string, unknown>;
  signal?: AbortSignal;
  mcpHeaders?: Record<string, string>;
  fetchImpl?: typeof fetch;
  readFiles: (ids: string[]) => Promise<Map<string, TransferFile>>;
  send: (args: Record<string, unknown>, requestState?: string) => Promise<ToolCallResult>;
}): Promise<{ result: ToolCallResult; downloads: ValidatedResourceBlob[] }> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const original = options.toolArguments ?? {};
  const slots: FileSlot[] = [];
  if (options.schema) {
    collectSlots(options.schema, original, [], slots);
  }
  const ids = slots.map((slot) => slot.id);
  if (new Set(ids).size !== ids.length) {
    return { result: failed('Each attached file can be sent once in a call.'), downloads: [] };
  }
  let files = new Map<string, TransferFile>();
  if (ids.length) {
    files = await options.readFiles(ids);
    const missing = ids.find((id) => !files.has(id));
    if (missing) {
      return {
        result: failed(
          `No attached file with id ${missing}. Use an id from an Attached file line.`,
        ),
        downloads: [],
      };
    }
  }
  const wireArgs = slots.length ? argumentsWithFiles(original, slots, files) : original;
  let result = await options.send(wireArgs);
  const upload = uploadOf(result);
  if (upload) {
    if (!options.mcpUrl) {
      return { result: failed('The file could not be sent.'), downloads: [] };
    }
    const byId = new Map(ids.map((id) => [id, files.get(id)!]));
    if (
      upload.uploads.length !== byId.size ||
      upload.uploads.some((item) => !byId.has(item.fileId))
    ) {
      return {
        result: failed('The server asked for a different file than the one offered.'),
        downloads: [],
      };
    }
    for (const target of upload.uploads) {
      assertTarget(target, options.mcpUrl);
      const file = byId.get(target.fileId)!;
      const url = resolveTransferUrl(options.mcpUrl, target);
      const headers = { ...(target.headers ?? {}) };
      let body: Uint8Array = file.bytes;
      if (target.form) {
        const packed = multipartBody(target, file);
        body = packed.body;
        headers['Content-Type'] = packed.contentType;
      }
      await sendBytes(fetchImpl, url, target.method ?? 'PUT', headers, body, options.signal);
    }
    result = await options.send(wireArgs, upload.requestState);
    if (result.resultType === 'upload_required') {
      return { result: failed('The server asked for the file twice.'), downloads: [] };
    }
  }
  const downloads: ValidatedResourceBlob[] = [];
  for (const target of downloadsOf(result)) {
    if (!options.mcpUrl && !target.url) {
      return { result: failed('The file could not be received.'), downloads: [] };
    }
    downloads.push(
      await readDownload(fetchImpl, options.mcpUrl ?? target.url ?? '', target, options.signal),
    );
  }
  return { result, downloads };
}
