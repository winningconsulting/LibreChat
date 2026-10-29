import type { ToolContentPart } from '../types';
import {
  DEFAULT_MCP_RESOURCE_BLOB_MAX_FILES,
  MCPResourceBlobError,
  extractAndValidateResourceBlobs,
} from './files';

function pdfBlob(extra = ''): string {
  return Buffer.from(`%PDF-1.4\n${extra}%%EOF`).toString('base64');
}

function zipBlob(): string {
  return Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00]).toString('base64');
}

function resourcePart({
  uri,
  mimeType,
  blob,
}: {
  uri: string;
  mimeType: string;
  blob: string;
}): ToolContentPart {
  return {
    type: 'resource',
    resource: {
      uri,
      mimeType,
      blob,
    },
  };
}

describe('extractAndValidateResourceBlobs', () => {
  const originalMaxBytes = process.env.MCP_RESOURCE_BLOB_MAX_BYTES;
  const originalMaxFiles = process.env.MCP_RESOURCE_BLOB_MAX_FILES;

  afterEach(() => {
    if (originalMaxBytes === undefined) {
      delete process.env.MCP_RESOURCE_BLOB_MAX_BYTES;
    } else {
      process.env.MCP_RESOURCE_BLOB_MAX_BYTES = originalMaxBytes;
    }
    if (originalMaxFiles === undefined) {
      delete process.env.MCP_RESOURCE_BLOB_MAX_FILES;
    } else {
      process.env.MCP_RESOURCE_BLOB_MAX_FILES = originalMaxFiles;
    }
  });

  it('returns empty resources and keeps non-blob content when none are present', () => {
    const content: ToolContentPart[] = [
      { type: 'text', text: 'hello' },
      {
        type: 'resource',
        resource: {
          uri: 'https://example.com/doc',
          mimeType: 'text/plain',
          text: 'note',
        },
      },
    ];

    const result = extractAndValidateResourceBlobs(content);
    expect(result.resources).toEqual([]);
    expect(result.content).toEqual(content);
  });

  it('extracts a valid PDF blob and strips it from returned content', () => {
    const blob = pdfBlob();
    const content: ToolContentPart[] = [
      { type: 'text', text: 'Created report.pdf' },
      resourcePart({
        uri: 'wdocs://file/11111111-1111-1111-1111-111111111111/report.pdf',
        mimeType: 'application/pdf',
        blob,
      }),
    ];

    const result = extractAndValidateResourceBlobs(content);
    expect(result.content).toEqual([{ type: 'text', text: 'Created report.pdf' }]);
    expect(result.resources).toHaveLength(1);
    expect(result.resources[0]).toMatchObject({
      filename: 'report.pdf',
      mimeType: 'application/pdf',
      uri: 'wdocs://file/11111111-1111-1111-1111-111111111111/report.pdf',
    });
    expect(result.resources[0].buffer.subarray(0, 5).toString('utf8')).toBe('%PDF-');
    expect(JSON.stringify(result)).not.toContain(blob);
  });

  it('accepts pptx and xlsx zip signatures', () => {
    const blob = zipBlob();
    const content: ToolContentPart[] = [
      resourcePart({
        uri: 'wdocs://file/a/deck.pptx',
        mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        blob,
      }),
      resourcePart({
        uri: 'wdocs://file/b/sheet.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        blob,
      }),
    ];

    const result = extractAndValidateResourceBlobs(content);
    expect(result.resources.map((r) => r.filename)).toEqual(['deck.pptx', 'sheet.xlsx']);
    expect(result.content).toEqual([]);
  });

  it('keeps ui:// resources in content', () => {
    const content: ToolContentPart[] = [
      {
        type: 'resource',
        resource: {
          uri: 'ui://widget/1',
          mimeType: 'text/html',
          text: '<div/>',
          blob: pdfBlob(),
        },
      },
    ];

    const result = extractAndValidateResourceBlobs(content);
    expect(result.resources).toEqual([]);
    expect(result.content).toEqual(content);
  });

  it('rejects disallowed MIME types', () => {
    expect(() =>
      extractAndValidateResourceBlobs([
        resourcePart({
          uri: 'wdocs://file/a/note.txt',
          mimeType: 'text/plain',
          blob: Buffer.from('hi').toString('base64'),
        }),
      ]),
    ).toThrow(MCPResourceBlobError);
  });

  it('rejects extension/MIME mismatches', () => {
    expect(() =>
      extractAndValidateResourceBlobs([
        resourcePart({
          uri: 'wdocs://file/a/report.pptx',
          mimeType: 'application/pdf',
          blob: pdfBlob(),
        }),
      ]),
    ).toThrow(/does not match MIME type/);
  });

  it('rejects path segments in filenames', () => {
    expect(() =>
      extractAndValidateResourceBlobs([
        resourcePart({
          uri: 'wdocs://file/a/..%2Freport.pdf',
          mimeType: 'application/pdf',
          blob: pdfBlob(),
        }),
      ]),
    ).toThrow(/path segments/);
  });

  it('rejects oversized base64 before decoding when possible', () => {
    process.env.MCP_RESOURCE_BLOB_MAX_BYTES = '16';
    const large = 'A'.repeat(64);
    expect(() =>
      extractAndValidateResourceBlobs([
        resourcePart({
          uri: 'wdocs://file/a/report.pdf',
          mimeType: 'application/pdf',
          blob: large,
        }),
      ]),
    ).toThrow(/exceeds maximum size/);
  });

  it('rejects too many resource blobs', () => {
    process.env.MCP_RESOURCE_BLOB_MAX_FILES = '1';
    expect(() =>
      extractAndValidateResourceBlobs([
        resourcePart({
          uri: 'wdocs://file/a/one.pdf',
          mimeType: 'application/pdf',
          blob: pdfBlob(),
        }),
        resourcePart({
          uri: 'wdocs://file/b/two.pdf',
          mimeType: 'application/pdf',
          blob: pdfBlob(),
        }),
      ]),
    ).toThrow(new RegExp(`maximum of 1`));
    expect(DEFAULT_MCP_RESOURCE_BLOB_MAX_FILES).toBeGreaterThan(0);
  });

  it('rejects invalid PDF signatures', () => {
    expect(() =>
      extractAndValidateResourceBlobs([
        resourcePart({
          uri: 'wdocs://file/a/report.pdf',
          mimeType: 'application/pdf',
          blob: Buffer.from('not-a-pdf').toString('base64'),
        }),
      ]),
    ).toThrow(/not a valid PDF/);
  });
});
