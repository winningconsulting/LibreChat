import { megabyte } from 'librechat-data-provider';
import type { ToolContentPart } from '../types';
import { extractAndValidateResourceBlobs } from './files';

function pdfBlob(extra = ''): string {
  return Buffer.from(`%PDF-1.4\n${extra}%%EOF`).toString('base64');
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
        uri: 'mcp-resource://file/11111111-1111-1111-1111-111111111111/report.pdf',
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
      uri: 'mcp-resource://file/11111111-1111-1111-1111-111111111111/report.pdf',
    });
    expect(JSON.stringify(result)).not.toContain(blob);
  });

  it('accepts MIME types allowed by default fileConfig (text, Office, images)', () => {
    const content: ToolContentPart[] = [
      resourcePart({
        uri: 'mcp-resource://file/a/note.txt',
        mimeType: 'text/plain',
        blob: Buffer.from('hello').toString('base64'),
      }),
      resourcePart({
        uri: 'mcp-resource://file/b/doc.docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        blob: Buffer.from('docx').toString('base64'),
      }),
      resourcePart({
        uri: 'mcp-resource://file/c/photo.png',
        mimeType: 'image/png',
        blob: Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64'),
      }),
    ];

    const result = extractAndValidateResourceBlobs(content);
    expect(result.resources.map((r) => r.filename)).toEqual(['note.txt', 'doc.docx', 'photo.png']);
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

  it('rejects MIME types outside fileConfig.supportedMimeTypes', () => {
    expect(() =>
      extractAndValidateResourceBlobs([
        resourcePart({
          uri: 'mcp-resource://file/a/payload.bin',
          mimeType: 'application/x-msdownload',
          blob: Buffer.from('MZ').toString('base64'),
        }),
      ]),
    ).toThrow(/not allowed for conversation attachments/);
  });

  it('honours a narrowed fileConfig MIME allowlist for a specific endpoint', () => {
    const narrowed = {
      fileConfig: {
        endpoints: {
          openAI: {
            supportedMimeTypes: ['^application/pdf$'],
          },
        },
      },
      endpoint: 'openAI',
    };

    expect(() =>
      extractAndValidateResourceBlobs(
        [
          resourcePart({
            uri: 'mcp-resource://file/a/note.txt',
            mimeType: 'text/plain',
            blob: Buffer.from('hi').toString('base64'),
          }),
        ],
        narrowed,
      ),
    ).toThrow(/not allowed for conversation attachments/);

    const pdf = extractAndValidateResourceBlobs(
      [
        resourcePart({
          uri: 'mcp-resource://file/a/report.pdf',
          mimeType: 'application/pdf',
          blob: pdfBlob(),
        }),
      ],
      narrowed,
    );
    expect(pdf.resources).toHaveLength(1);
  });

  it('rejects path segments in filenames', () => {
    expect(() =>
      extractAndValidateResourceBlobs([
        resourcePart({
          uri: 'mcp-resource://file/a/..%2Freport.pdf',
          mimeType: 'application/pdf',
          blob: pdfBlob(),
        }),
      ]),
    ).toThrow(/path segments/);
  });

  it('rejects blobs larger than fileConfig size limits', () => {
    const limitBytes = 16;
    const large = 'A'.repeat(64);
    expect(() =>
      extractAndValidateResourceBlobs(
        [
          resourcePart({
            uri: 'mcp-resource://file/a/report.pdf',
            mimeType: 'application/pdf',
            blob: large,
          }),
        ],
        {
          fileConfig: {
            serverFileSizeLimit: limitBytes / megabyte,
            endpoints: {
              agents: {
                fileSizeLimit: limitBytes / megabyte,
              },
            },
          },
        },
      ),
    ).toThrow(/exceeds maximum size/);
  });

  it('rejects too many resource blobs using endpoint fileLimit', () => {
    expect(() =>
      extractAndValidateResourceBlobs(
        [
          resourcePart({
            uri: 'mcp-resource://file/a/one.pdf',
            mimeType: 'application/pdf',
            blob: pdfBlob(),
          }),
          resourcePart({
            uri: 'mcp-resource://file/b/two.pdf',
            mimeType: 'application/pdf',
            blob: pdfBlob(),
          }),
        ],
        {
          fileConfig: {
            endpoints: {
              agents: {
                fileLimit: 1,
              },
            },
          },
        },
      ),
    ).toThrow(/maximum of 1/);
  });

  it('rejects missing filenames', () => {
    expect(() =>
      extractAndValidateResourceBlobs([
        resourcePart({
          uri: 'mcp-resource://host/',
          mimeType: 'application/pdf',
          blob: pdfBlob(),
        }),
      ]),
    ).toThrow(/filename is missing or invalid/);
  });
});
