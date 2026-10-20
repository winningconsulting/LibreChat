import { EModelEndpoint, megabyte, mergeFileConfig } from 'librechat-data-provider';
import {
  collectSupportedMimeTypesForUpload,
  isConversationAttachmentMimeTypeAllowed,
  normalizeAttachmentMimeType,
  resolveConversationAttachmentPolicy,
} from './admission';

describe('conversation attachment admission', () => {
  it('defaults to the agents endpoint fileConfig policy', () => {
    const policy = resolveConversationAttachmentPolicy(undefined);
    expect(policy.fileLimit).toBe(10);
    expect(policy.fileSizeLimit).toBe(512 * megabyte);
    expect(
      isConversationAttachmentMimeTypeAllowed('application/pdf', policy.supportedMimeTypes),
    ).toBe(true);
    expect(
      isConversationAttachmentMimeTypeAllowed(
        'application/x-msdownload',
        policy.supportedMimeTypes,
      ),
    ).toBe(false);
  });

  it('takes the stricter of serverFileSizeLimit and endpoint fileSizeLimit', () => {
    const policy = resolveConversationAttachmentPolicy({
      serverFileSizeLimit: 40,
      endpoints: {
        agents: {
          fileSizeLimit: 5,
        },
      },
    });
    expect(policy.fileSizeLimit).toBe(5 * megabyte);
  });

  it('unions MIME types across endpoints for agents (same as multer)', () => {
    const merged = mergeFileConfig({
      endpoints: {
        agents: {
          supportedMimeTypes: ['^application/pdf$'],
        },
        openAI: {
          supportedMimeTypes: ['^text/plain$'],
        },
      },
    });
    const endpointFileConfig = merged.endpoints[EModelEndpoint.agents]!;
    const types = collectSupportedMimeTypesForUpload(merged, endpointFileConfig);
    expect(isConversationAttachmentMimeTypeAllowed('application/pdf', types)).toBe(true);
    expect(isConversationAttachmentMimeTypeAllowed('text/plain', types)).toBe(true);
  });

  it('normalizes MIME aliases like upload filters', () => {
    expect(normalizeAttachmentMimeType('archive.zip', 'application/x-zip-compressed')).toBe(
      'application/zip',
    );
  });
});
