import {
  callToolWithFileTransfers,
  fileTransferRequestMeta,
  presentFileArguments,
  resolveTransferUrl,
  type JsonSchema,
  type TransferFile,
} from '../files';
import { formatMCPServerTools } from '../tools';

const schema: JsonSchema = {
  type: 'object',
  properties: {
    prompt: { type: 'string' },
    images: {
      type: 'array',
      items: {
        type: 'object',
        'x-mcp-file': { accept: ['image/png'] },
        properties: {
          id: { type: 'string' },
          mimeType: { type: 'string' },
          size: { type: 'integer' },
          data: { type: 'string' },
        },
        required: ['id', 'mimeType', 'size'],
      },
    },
  },
  required: ['prompt'],
};

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

function file(id: string): TransferFile {
  return { id, name: 'banner.png', mimeType: 'image/png', bytes: png };
}

describe('file transfers', () => {
  it('declares the extension without putting bytes in the declaration', () => {
    expect(JSON.stringify(fileTransferRequestMeta())).not.toContain('base64');
    expect(fileTransferRequestMeta()).toEqual({
      'io.modelcontextprotocol/clientCapabilities': {
        extensions: {
          'io.modelcontextprotocol/files': { upload: {}, download: {} },
        },
      },
    });
  });

  it('shows the model an attachment id where the server declared a file', () => {
    const shown = presentFileArguments(schema);
    expect(shown.properties?.images.items).toEqual({
      type: 'string',
      description: 'Id of an attached file, from an Attached file line.',
    });
    expect(shown.properties?.prompt).toEqual({ type: 'string' });
  });

  it('leaves the schema unchanged for the model when the server flag is off', () => {
    const off = formatMCPServerTools('images', [
      { name: 'create_image', description: 'Makes an image', inputSchema: schema },
    ]);
    const on = formatMCPServerTools(
      'images',
      [{ name: 'create_image', description: 'Makes an image', inputSchema: schema }],
      { fileTransfers: true },
    );
    const offImages = off['create_image_mcp_images'].function.parameters.properties?.images;
    const onImages = on['create_image_mcp_images'].function.parameters.properties?.images;
    expect(offImages.items.type).toBe('object');
    expect(onImages.items.type).toBe('string');
  });

  it('uploads the bytes out of band and downloads the result without storing them in the call', async () => {
    const original = { prompt: 'a banner', images: ['file-1'] };
    const sent: unknown[] = [];
    const fetchImpl = jest.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        expect(url).toBe('https://images.example/mcp/images/uploads/tok');
        expect(Buffer.from(init.body as Buffer)).toEqual(Buffer.from(png));
        expect(init.redirect).toBe('manual');
        return new Response(null, { status: 204 });
      }
      expect(url).toBe('https://images.example/mcp/images/downloads/tok');
      return new Response(png, {
        status: 200,
        headers: { 'content-length': String(png.byteLength), 'content-type': 'image/png' },
      });
    });
    const exchanged = await callToolWithFileTransfers({
      mcpUrl: 'https://images.example/mcp/images',
      schema,
      toolArguments: original,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      readFiles: async () => new Map([['file-1', file('file-1')]]),
      send: async (args, requestState) => {
        sent.push({ args, requestState });
        if (!requestState) {
          return {
            resultType: 'upload_required',
            requestState: 'state-1',
            uploads: [
              {
                fileId: 'file-1',
                path: '/uploads/tok',
                method: 'PUT',
                headers: { 'Content-Type': 'image/png' },
                credentials: 'omit',
              },
            ],
          };
        }
        return {
          content: [{ type: 'text', text: 'Made image img_abc.' }],
          _meta: {
            'io.modelcontextprotocol/files': {
              downloads: [
                {
                  name: 'w-image-img_abc.png',
                  mimeType: 'image/png',
                  size: png.byteLength,
                  path: '/downloads/tok',
                  credentials: 'omit',
                },
              ],
            },
          },
        };
      },
    });

    expect(original).toEqual({ prompt: 'a banner', images: ['file-1'] });
    expect(sent[0]).toEqual({
      args: {
        prompt: 'a banner',
        images: [{ id: 'file-1', name: 'banner.png', mimeType: 'image/png', size: png.byteLength }],
      },
      requestState: undefined,
    });
    expect(JSON.stringify(sent[0])).not.toContain('iVBORw');
    expect(sent[1]).toMatchObject({ requestState: 'state-1' });
    expect(exchanged.downloads).toEqual([
      {
        filename: 'w-image-img_abc.png',
        mimeType: 'image/png',
        buffer: Buffer.from(png),
        uri: 'mcp-file://downloads/w-image-img_abc.png',
      },
    ]);
    expect(exchanged.result.content?.[0].text).toBe('Made image img_abc.');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('refuses a missing attachment before calling the server', async () => {
    const send = jest.fn();
    const exchanged = await callToolWithFileTransfers({
      mcpUrl: 'https://images.example/mcp/images',
      schema,
      toolArguments: { prompt: 'a banner', images: ['missing'] },
      readFiles: async () => new Map(),
      send,
    });
    expect(send).not.toHaveBeenCalled();
    expect(exchanged.result.isError).toBe(true);
    expect(exchanged.downloads).toEqual([]);
  });

  it('rejects a download URL that is not https', async () => {
    await expect(
      callToolWithFileTransfers({
        mcpUrl: 'https://images.example/mcp/images',
        schema,
        toolArguments: { prompt: 'a banner' },
        readFiles: async () => new Map(),
        send: async () => ({
          content: [{ type: 'text', text: 'Made it.' }],
          _meta: {
            'io.modelcontextprotocol/files': {
              downloads: [
                {
                  name: 'a.png',
                  mimeType: 'image/png',
                  size: 1,
                  url: 'http://files.example/a.png',
                  credentials: 'omit',
                },
              ],
            },
          },
        }),
      }),
    ).rejects.toThrow(/https/);
  });

  it('resolves a path target under the MCP address', () => {
    expect(
      resolveTransferUrl('https://images.example/mcp/images?x=1', { path: '/uploads/tok' }),
    ).toBe('https://images.example/mcp/images/uploads/tok?x=1');
  });
});
