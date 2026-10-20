import {
  EModelEndpoint,
  fileConfig as defaultFileConfig,
  getEndpointFileConfig,
  inferMimeType,
  isAgentsEndpoint,
  mergeFileConfig,
} from 'librechat-data-provider';
import type { EndpointFileConfig, FileConfig, RegexLike } from 'librechat-data-provider';

export type ConversationAttachmentPolicy = {
  supportedMimeTypes: RegexLike[];
  /** Effective per-file byte limit (min of server + endpoint caps when both are set > 0). */
  fileSizeLimit: number;
  fileLimit: number;
};

/**
 * Same MIME union multer uses for agent uploads: any type accepted by at least one
 * configured endpoint, so a later provider-specific check can still widen admission.
 */
export function collectSupportedMimeTypesForUpload(
  customFileConfig: FileConfig,
  endpointFileConfig: EndpointFileConfig,
): RegexLike[] {
  const merged = [...(endpointFileConfig.supportedMimeTypes ?? [])];
  for (const config of Object.values(customFileConfig.endpoints ?? {})) {
    for (const mimeType of config?.supportedMimeTypes ?? []) {
      merged.push(mimeType);
    }
  }
  return merged;
}

/**
 * Resolves the MIME / size / count policy used when admitting a conversation
 * attachment — the same `fileConfig` knobs multer and the client upload path use.
 */
export function resolveConversationAttachmentPolicy(
  rawFileConfig: unknown,
  options?: { endpoint?: string | null; endpointType?: string | null },
): ConversationAttachmentPolicy {
  const merged = mergeFileConfig(rawFileConfig as Parameters<typeof mergeFileConfig>[0]);
  const endpoint = options?.endpoint ?? EModelEndpoint.agents;
  const endpointFileConfig = getEndpointFileConfig({
    fileConfig: merged,
    endpoint,
    endpointType: options?.endpointType,
  });

  const defaultEndpoint = defaultFileConfig.endpoints.default;
  const supportedMimeTypes = isAgentsEndpoint(endpoint)
    ? collectSupportedMimeTypesForUpload(merged, endpointFileConfig)
    : (endpointFileConfig.supportedMimeTypes ?? defaultEndpoint.supportedMimeTypes ?? []);

  const sizeCandidates = [merged.serverFileSizeLimit, endpointFileConfig.fileSizeLimit].filter(
    (n): n is number => typeof n === 'number' && n > 0,
  );
  const fileSizeLimit =
    sizeCandidates.length > 0
      ? Math.min(...sizeCandidates)
      : (defaultFileConfig.serverFileSizeLimit ?? defaultEndpoint.fileSizeLimit ?? 0);

  const fileLimit =
    typeof endpointFileConfig.fileLimit === 'number' && endpointFileConfig.fileLimit > 0
      ? endpointFileConfig.fileLimit
      : (defaultEndpoint.fileLimit ?? 10);

  return { supportedMimeTypes, fileSizeLimit, fileLimit };
}

/** Normalize MIME the same way upload filters do before `fileConfig.checkType`. */
export function normalizeAttachmentMimeType(filename: string, mimeType: string): string {
  return inferMimeType(filename, mimeType);
}

export function isConversationAttachmentMimeTypeAllowed(
  mimeType: string,
  supportedMimeTypes: RegexLike[],
): boolean {
  return defaultFileConfig.checkType(mimeType, supportedMimeTypes);
}
