const sharp = require('sharp');

const mockSaveBuffer = jest.fn(
  async ({ userId, fileName, basePath }) => `/${basePath}/${userId}/${fileName}`,
);
const mockDeleteFile = jest.fn();
const mockCreateFile = jest.fn(async (data) => data);

jest.mock('@librechat/data-schemas', () => ({
  logger: { error: jest.fn(), warn: jest.fn() },
}));
jest.mock('@librechat/api', () => ({
  getStorageMetadata: () => ({}),
  sanitizeFilename: (name) => name,
}));
jest.mock('~/server/services/Files/strategies', () => ({
  getStrategyFunctions: () => ({ saveBuffer: mockSaveBuffer, deleteFile: mockDeleteFile }),
}));
jest.mock('~/server/services/Files/retention', () => ({
  getRetentionExpiry: async () => ({}),
}));
jest.mock('~/models', () => ({
  createFile: (...args) => mockCreateFile(...args),
  deleteFiles: jest.fn(),
}));

const { persistResourceBlobs } = require('./persistResourceBlobs');

const context = {
  req: { user: { id: 'user1' }, config: { fileStrategy: 'local' } },
  userId: 'user1',
  conversationId: 'convo1',
  messageId: 'msg1',
  toolCallId: 'call1',
};

describe('persistResourceBlobs', () => {
  it('keeps documents in uploads, as files to download', async () => {
    const [file] = await persistResourceBlobs(
      [
        {
          filename: 'report.pdf',
          mimeType: 'application/pdf',
          buffer: Buffer.from('%PDF-1.4'),
          uri: 'x://report.pdf',
        },
      ],
      context,
    );

    expect(mockSaveBuffer.mock.calls[0][0].basePath).toBe('uploads');
    expect(file.filepath).toMatch(/^\/uploads\/user1\/.+__report\.pdf$/);
    expect(file.width).toBeUndefined();
    expect(file.height).toBeUndefined();
  });

  it('keeps images in the images folder with their size, so the chat shows them as images', async () => {
    const buffer = await sharp({
      create: { width: 3, height: 2, channels: 3, background: '#ffffff' },
    })
      .png()
      .toBuffer();

    const [file] = await persistResourceBlobs(
      [{ filename: 'w-image-img_1.png', mimeType: 'image/png', buffer, uri: 'x://img.png' }],
      context,
    );

    expect(mockSaveBuffer.mock.calls[0][0].basePath).toBe('images');
    expect(file.filepath).toMatch(/^\/images\/user1\/.+__w-image-img_1\.png$/);
    expect([file.width, file.height]).toEqual([3, 2]);
    expect(file.type).toBe('image/png');
    expect(file.toolCallId).toBe('call1');
    expect(mockCreateFile.mock.calls[0][0]).toMatchObject({
      width: 3,
      height: 2,
      type: 'image/png',
    });
  });
});
