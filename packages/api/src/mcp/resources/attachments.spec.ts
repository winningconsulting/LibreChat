import { STORED_FILES_ARTIFACT_KEY } from './persist';
import { collectStoredFileAttachments, enqueueStoredFileAttachments } from './attachments';
import type { StoredResourceFile } from './persist';

describe('stored file attachment helpers', () => {
  const file: StoredResourceFile = {
    file_id: 'f1',
    filename: 'report.pdf',
    filepath: '/uploads/u1/f1__report.pdf',
    type: 'application/pdf',
    bytes: 12,
    embedded: false,
    object: 'file',
    user: 'u1',
  };

  it('collectStoredFileAttachments returns empty when artifact has no stored files', () => {
    expect(
      collectStoredFileAttachments({
        artifact: {},
        messageId: 'm1',
        toolCallId: 't1',
        conversationId: 'c1',
      }),
    ).toEqual([]);
  });

  it('collectStoredFileAttachments merges message routing metadata', () => {
    expect(
      collectStoredFileAttachments({
        artifact: { [STORED_FILES_ARTIFACT_KEY]: [file] },
        messageId: 'm1',
        toolCallId: 't1',
        conversationId: 'c1',
      }),
    ).toEqual([
      {
        ...file,
        messageId: 'm1',
        toolCallId: 't1',
        conversationId: 'c1',
      },
    ]);
  });

  it('enqueueStoredFileAttachments pushes emit promises', async () => {
    const artifactPromises: Array<Promise<unknown>> = [];
    const emit = jest.fn();

    enqueueStoredFileAttachments({
      artifact: { [STORED_FILES_ARTIFACT_KEY]: [file] },
      messageId: 'm1',
      toolCallId: 't1',
      conversationId: 'c1',
      artifactPromises,
      emit,
      shouldEmit: () => true,
    });

    expect(artifactPromises).toHaveLength(1);
    await Promise.all(artifactPromises);
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        file_id: 'f1',
        messageId: 'm1',
        toolCallId: 't1',
        conversationId: 'c1',
      }),
    );
  });

  it('enqueueStoredFileAttachments skips emit when shouldEmit is false', async () => {
    const artifactPromises: Array<Promise<unknown>> = [];
    const emit = jest.fn();

    enqueueStoredFileAttachments({
      artifact: { [STORED_FILES_ARTIFACT_KEY]: [file] },
      messageId: 'm1',
      toolCallId: 't1',
      artifactPromises,
      emit,
      shouldEmit: () => false,
    });

    const results = await Promise.all(artifactPromises);
    expect(emit).not.toHaveBeenCalled();
    expect(results[0]).toMatchObject({ file_id: 'f1', messageId: 'm1' });
  });
});
