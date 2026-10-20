jest.mock('@librechat/data-schemas', () => ({
  logger: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock('@librechat/api', () => ({
  getStorageMetadata: jest.fn(() => ({ storageKey: 'key-1' })),
  sanitizeFilename: jest.fn((name) => name),
}));

jest.mock('~/server/services/Files/strategies', () => ({
  getStrategyFunctions: jest.fn(),
}));

jest.mock('~/server/services/Files/retention', () => ({
  getRetentionExpiry: jest.fn(async () => ({})),
}));

jest.mock('~/models', () => ({
  createFile: jest.fn(),
  deleteFiles: jest.fn(),
}));

const { getStrategyFunctions } = require('~/server/services/Files/strategies');
const db = require('~/models');
const { persistResourceBlobs } = require('./persistResourceBlobs');

describe('persistResourceBlobs', () => {
  const req = {
    user: { id: 'u1' },
    config: { fileStrategy: 'local' },
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns an empty list when there are no resources', async () => {
    await expect(
      persistResourceBlobs([], {
        req,
        userId: 'u1',
      }),
    ).resolves.toEqual([]);
  });

  it('rolls back storage and metadata when a later save fails', async () => {
    const saveBuffer = jest
      .fn()
      .mockResolvedValueOnce('/uploads/u1/f1__one.pdf')
      .mockResolvedValueOnce('/uploads/u1/f2__two.pdf');
    const deleteFile = jest.fn().mockResolvedValue(undefined);
    getStrategyFunctions.mockReturnValue({ saveBuffer, deleteFile });

    db.createFile
      .mockResolvedValueOnce({
        file_id: 'saved-1',
        filename: 'one.pdf',
        filepath: '/uploads/u1/f1__one.pdf',
        type: 'application/pdf',
        bytes: 12,
        source: 'local',
        context: 'message_attachment',
      })
      .mockRejectedValueOnce(new Error('db write failed'));
    db.deleteFiles.mockResolvedValue({ deletedCount: 1 });

    const resources = [
      {
        filename: 'one.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('%PDF-1.4'),
        uri: 'mcp-resource://file/a/one.pdf',
      },
      {
        filename: 'two.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('%PDF-1.4'),
        uri: 'mcp-resource://file/a/two.pdf',
      },
    ];

    await expect(
      persistResourceBlobs(resources, {
        req,
        userId: 'u1',
        conversationId: 'c1',
        messageId: 'm1',
        toolCallId: 't1',
      }),
    ).rejects.toThrow('db write failed');

    expect(deleteFile).toHaveBeenCalledWith(req, expect.objectContaining({ file_id: 'saved-1' }));
    expect(db.deleteFiles).toHaveBeenCalledWith(['saved-1']);
  });
});
