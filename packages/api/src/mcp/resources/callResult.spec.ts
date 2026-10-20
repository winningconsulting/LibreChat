import { McpError } from '@modelcontextprotocol/sdk/types.js';
import type { MCPToolCallResponse, Provider } from '../types';
import type { PersistResourceBlobs } from './persist';
import {
  formatToolResultWithOptionalBlobPersistence,
  type FormatToolContentFn,
} from './callResult';
import { STORED_FILES_ARTIFACT_KEY } from './persist';

function pdfBlob(): string {
  return Buffer.from('%PDF-1.4\n%%EOF').toString('base64');
}

function toolResultWithPdf(): MCPToolCallResponse {
  return {
    content: [
      { type: 'text', text: 'Created report.pdf' },
      {
        type: 'resource',
        resource: {
          uri: 'mcp-resource://file/a/report.pdf',
          mimeType: 'application/pdf',
          blob: pdfBlob(),
        },
      },
    ],
  };
}

describe('formatToolResultWithOptionalBlobPersistence', () => {
  const provider = 'openai' as Provider;
  const formatToolContentImpl: FormatToolContentFn = (result) => {
    const text = (result?.content ?? [])
      .filter((part) => part.type === 'text')
      .map((part) => ('text' in part ? part.text : ''))
      .join('\n');
    return [text, {}];
  };
  const formatToolContent = jest.fn(formatToolContentImpl);

  beforeEach(() => {
    formatToolContent.mockClear();
  });

  it('preserves current formatting when persistence is disabled', async () => {
    const toolResult = toolResultWithPdf();
    const result = await formatToolResultWithOptionalBlobPersistence({
      toolResult,
      provider,
      shouldPersistBlobs: false,
      errorPrefix: '[MCP][demo][tool]',
      formatToolContent,
    });

    expect(formatToolContent).toHaveBeenCalledWith(toolResult, provider, undefined);
    expect(result[0]).toContain('Created report.pdf');
    expect(result[1]).not.toHaveProperty(STORED_FILES_ARTIFACT_KEY);
  });

  it('strips base64 blobs and attaches stored file metadata when enabled', async () => {
    const blob = pdfBlob();
    const toolResult = toolResultWithPdf();
    const persistResourceBlobs: PersistResourceBlobs = jest.fn(async (resources) =>
      resources.map((resource) => ({
        file_id: 'f1',
        filename: resource.filename,
        filepath: `/uploads/u1/${resource.filename}`,
        type: resource.mimeType,
        bytes: resource.buffer.length,
        embedded: false,
        object: 'file' as const,
        user: 'u1',
      })),
    );

    const result = await formatToolResultWithOptionalBlobPersistence({
      toolResult,
      provider,
      shouldPersistBlobs: true,
      persistResourceBlobs,
      resourcePersistContext: {
        req: {
          user: { id: 'u1' },
          config: {},
        },
      },
      userId: 'u1',
      errorPrefix: '[MCP][demo][tool]',
      formatToolContent,
    });

    expect(persistResourceBlobs).toHaveBeenCalledTimes(1);
    expect(formatToolContent).toHaveBeenCalledWith(
      expect.objectContaining({
        content: [{ type: 'text', text: 'Created report.pdf' }],
      }),
      provider,
      undefined,
    );
    expect(JSON.stringify(result)).not.toContain(blob);
    expect(result[1]).toMatchObject({
      [STORED_FILES_ARTIFACT_KEY]: [
        expect.objectContaining({ file_id: 'f1', filename: 'report.pdf' }),
      ],
    });
  });

  it('fails without saving when the user or request context is missing', async () => {
    const persistResourceBlobs = jest.fn();

    await expect(
      formatToolResultWithOptionalBlobPersistence({
        toolResult: toolResultWithPdf(),
        provider,
        shouldPersistBlobs: true,
        persistResourceBlobs,
        userId: undefined,
        errorPrefix: '[MCP][demo][tool]',
        formatToolContent,
      }),
    ).rejects.toBeInstanceOf(McpError);

    expect(persistResourceBlobs).not.toHaveBeenCalled();
  });
});
