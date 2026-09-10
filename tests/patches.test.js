import { createRequire } from 'node:module';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { patchSerializedIds, patchMediaDownload, applyPagePatches } = require('../src/patches');
const { Message } = require('whatsapp-web.js');

// Captured before any test replaces it: the media tests below patch the real prototype
const stockDownloadMedia = Message.prototype.downloadMedia;

// Builds a stand-in for the WhatsApp Web page context. `widField` and `msgKeyField` name the property
// each class exposes its serialized id under: `_serialized` on healthy builds, and a minified alias
// such as `$1` on the builds that renamed it. The two classes are independent — a build can rename
// one and leave the other alone.
const createFakeWindow = ({ widField = '_serialized', msgKeyField = '_serialized' } = {}) => {
  class Wid {
    constructor(jid) {
      const [user, server] = jid.split('@');
      this.user = user;
      this.server = server;
      this[widField] = jid;
    }
  }

  class MsgKey {
    constructor({ from, to, id, selfDir }) {
      this.fromMe = selfDir === 'out';
      this.remote = to;
      this.id = id;
      this.self = selfDir;
      this[msgKeyField] = `${this.fromMe}_${to[widField]}_${id}_${selfDir}`;
    }
  }

  const modules = {
    WAWebWidFactory: { createWid: jid => new Wid(jid) },
    WAWebMsgKey: MsgKey,
  };

  return {
    Wid,
    MsgKey,
    require: name => {
      if (!modules[name]) {
        throw new Error(`module ${name} is not available`);
      }
      return modules[name];
    },
    WWebJS: {
      getMessageModel: message => ({ ...message }),
      getChatModel: async chat => ({ ...chat }),
      getContactModel: contact => ({ ...contact }),
    },
  };
};

const createFakeClient = fakeWindow => ({
  pupPage: {
    evaluate: async (pageFunction, ...args) => {
      global.window = fakeWindow;
      try {
        return await pageFunction(...args);
      } finally {
        delete global.window;
      }
    },
  },
});

const newMsgKey = fakeWindow =>
  new fakeWindow.MsgKey({
    from: fakeWindow.require('WAWebWidFactory').createWid('1@c.us'),
    to: fakeWindow.require('WAWebWidFactory').createWid('123@c.us'),
    id: 'ABCD',
    selfDir: 'out',
  });

// fileParallelism is off, so a leaked global.window would be visible to every later test file
afterEach(() => {
  delete global.window;
});

afterAll(() => {
  Message.prototype.downloadMedia = stockDownloadMedia;
});

describe('patchSerializedIds', () => {
  it('restores _serialized on both classes when the build renamed both', async () => {
    const fakeWindow = createFakeWindow({ widField: '$1', msgKeyField: '$1' });

    const result = await patchSerializedIds(createFakeClient(fakeWindow));

    expect(result.applied).toBe(true);
    expect(result.wid).toEqual({ patched: true, alias: '$1' });
    expect(result.msgKey).toEqual({ patched: true, alias: '$1' });
    expect(fakeWindow.require('WAWebWidFactory').createWid('123@c.us')._serialized).toBe('123@c.us');
    expect(newMsgKey(fakeWindow)._serialized).toBe('true_123@c.us_ABCD_out');
  });

  // The case that reached production upstream: the wid probe found a healthy `_serialized` and the
  // original patch bailed out before it ever looked at MsgKey, which is the class sendMessage needs
  // to find the message it has just sent.
  it('patches MsgKey even when Wid still exposes _serialized', async () => {
    const fakeWindow = createFakeWindow({ widField: '_serialized', msgKeyField: '$1' });

    const result = await patchSerializedIds(createFakeClient(fakeWindow));

    expect(result.applied).toBe(true);
    expect(result.wid).toEqual({ patched: false, reason: 'exposes _serialized' });
    expect(result.msgKey).toEqual({ patched: true, alias: '$1' });
    expect(newMsgKey(fakeWindow)._serialized).toBe('true_123@c.us_ABCD_out');
  });

  // `$1` is minifier output, so the index is not something to rely on across builds
  it('finds the alias whatever it is named', async () => {
    const fakeWindow = createFakeWindow({ widField: '$7', msgKeyField: '$4' });

    const result = await patchSerializedIds(createFakeClient(fakeWindow));

    expect(result.wid).toEqual({ patched: true, alias: '$7' });
    expect(result.msgKey).toEqual({ patched: true, alias: '$4' });
    expect(newMsgKey(fakeWindow)._serialized).toBe('true_123@c.us_ABCD_out');
  });

  it('leaves a healthy build untouched', async () => {
    const fakeWindow = createFakeWindow();
    const getMessageModel = fakeWindow.WWebJS.getMessageModel;

    const result = await patchSerializedIds(createFakeClient(fakeWindow));

    expect(result.applied).toBe(false);
    expect(result.reason).toBe('nothing to restore');
    expect(result.wid).toEqual({ patched: false, reason: 'exposes _serialized' });
    expect(result.msgKey).toEqual({ patched: false, reason: 'exposes _serialized' });
    expect(fakeWindow.WWebJS.getMessageModel).toBe(getMessageModel);
    expect(Object.getOwnPropertyDescriptor(fakeWindow.Wid.prototype, '_serialized')).toBeUndefined();
    expect(Object.getOwnPropertyDescriptor(fakeWindow.MsgKey.prototype, '_serialized')).toBeUndefined();
  });

  // A build whose factory hands back a plain object instead of a class instance would otherwise put
  // the getter on Object.prototype, and every object on the page would answer `_serialized`.
  it('refuses to patch when the probe is a plain object', async () => {
    const fakeWindow = {
      require: name => {
        if (name === 'WAWebWidFactory') {
          return { createWid: jid => ({ user: jid.split('@')[0], server: 'c.us', $1: jid }) };
        }
        if (name === 'WAWebMsgKey') {
          return class {
            constructor() {
              this.id = 'x';
            }
          };
        }
        throw new Error(`module ${name} is not available`);
      },
      WWebJS: { getMessageModel: model => model },
    };

    const result = await patchSerializedIds(createFakeClient(fakeWindow));

    expect(result.wid).toEqual({ patched: false, reason: 'probe is a plain object' });
    expect(Object.getOwnPropertyDescriptor(Object.prototype, '_serialized')).toBeUndefined();
    expect(result.applied).toBe(false);
  });

  describe('once an alias was found', () => {
    let fakeWindow;

    beforeEach(async () => {
      fakeWindow = createFakeWindow({ widField: '$1', msgKeyField: '$1' });
      await patchSerializedIds(createFakeClient(fakeWindow));
    });

    it('keeps _serialized writable', () => {
      const wid = fakeWindow.require('WAWebWidFactory').createWid('123@c.us');
      wid._serialized = '456@c.us';
      expect(wid._serialized).toBe('456@c.us');
    });

    it('restores _serialized on the plain ids returned by the model getters', async () => {
      const model = fakeWindow.WWebJS.getMessageModel({ id: { fromMe: true, remote: '123@c.us', id: 'ABCD', $1: 'true_123@c.us_ABCD_out' }, body: 'hello' });
      expect(model.id._serialized).toBe('true_123@c.us_ABCD_out');

      const chat = await fakeWindow.WWebJS.getChatModel({ id: { user: '123', server: 'c.us', $1: '123@c.us' } });
      expect(chat.id._serialized).toBe('123@c.us');
    });

    // The prototype getter answers `_serialized` on a live instance, but puppeteer only ships own
    // enumerable properties back to node — so an instance that reaches a model getter unwrapped
    // needs the field written onto itself, not merely readable through the prototype.
    it('writes _serialized as an own property on the live ids the model getters pass through', () => {
      const model = fakeWindow.WWebJS.getMessageModel({ id: newMsgKey(fakeWindow), body: 'hello' });

      expect(Object.hasOwn(model.id, '_serialized')).toBe(true);
      expect(model.id._serialized).toBe('true_123@c.us_ABCD_out');
    });

    it('applies again after the page reloaded and dropped the patch', async () => {
      // `ready` fires again on every reload, and the page comes back without the prototype getter.
      // Upstream saw the patch go stale about a day into each session, and `Msg.get(key._serialized)`
      // started missing for every message the library had just sent.
      const reloaded = createFakeWindow({ widField: '$1', msgKeyField: '$1' });

      const result = await patchSerializedIds(createFakeClient(reloaded));

      expect(result.applied).toBe(true);
      // this is the read whatsapp-web.js does on the message it has just sent
      expect(newMsgKey(reloaded)._serialized).toBe('true_123@c.us_ABCD_out');
    });

    it('does not apply twice', async () => {
      const wrapped = fakeWindow.WWebJS.getMessageModel;

      const result = await patchSerializedIds(createFakeClient(fakeWindow));

      expect(result.applied).toBe(false);
      expect(result.reason).toBe('already applied');
      expect(fakeWindow.WWebJS.getMessageModel).toBe(wrapped);
    });
  });
});

// The failure this patch exists for: WhatsApp Web 2.3000.x keeps the Msg collection under a key the
// serialized id no longer matches, so `Msg.get()` misses and whatsapp-web.js falls through to
// `Msg.getMessagesById()`, whose IndexedDB lookup throws a minified DataError. `indexedKeys` names
// the keys this fake page will actually resolve — everything else behaves like the broken build.
const createFakeMediaWindow = ({
  indexedKeys = [],
  models = [],
  mediaStage = 'RESOLVED',
  stageAfterDownload = 'RESOLVED',
  cached = null,
  mediaData = { mediaStage: 'RESOLVED' },
} = {}) => {
  const calls = { get: [], getMessagesById: 0, downloadManager: 0, asked: 0 };
  const blob = { arrayBuffer: async () => new ArrayBuffer(8) };

  const message = {
    id: { fromMe: false, remote: '120363402133099473@g.us', id: 'ACAF63', participant: '167474247016533@lid' },
    mediaData: mediaData && { ...mediaData, mediaStage },
    // the page hangs the fetched media off `mediaObject`, not off the message — only it holds the
    // key material a media retry refreshed
    mediaObject: { filehash: 'plain', mediaBlob: null },
    type: 'image',
    mimetype: 'image/jpeg',
    filename: undefined,
    size: 96945,
    downloadMedia: async () => {
      calls.asked++;
      if (message.mediaData) {
        message.mediaData.mediaStage = stageAfterDownload;
      }
      if (stageAfterDownload === 'RESOLVED') {
        message.mediaObject.mediaBlob = { forceToBlob: () => blob };
      }
    },
  };

  const modules = {
    WAWebCollections: {
      Msg: {
        get: key => {
          calls.get.push(key);
          if (indexedKeys.includes(key)) {
            return message;
          }
          // what the real build does for a key it cannot use
          const error = new Error("Failed to execute 'get' on 'IDBObjectStore': No key or key range specified.");
          error.name = 'DataError';
          throw error;
        },
        getMessagesById: async () => {
          calls.getMessagesById++;
          throw new Error('the IndexedDB fallback must never be reached');
        },
      },
    },
    WAWebMediaInMemoryBlobCache: { InMemoryMediaBlobCache: { get: filehash => (filehash === 'plain' ? cached : null) } },
    WAWebDownloadManager: {
      get downloadManager() {
        calls.downloadManager++;
        throw new Error('re-decrypting the media must never be reached');
      },
    },
  };

  return {
    calls,
    blob,
    message,
    require: name => {
      if (!modules[name]) {
        throw new Error(`module ${name} is not available`);
      }
      return modules[name];
    },
    WWebJS: {
      arrayBufferToBase64Async: async () => 'BASE64DATA',
      // the collection the library already reads to hand the message to the caller
      getChat: async () => ({ msgs: { getModelsArray: () => models.map(m => (m === 'match' ? message : { id: { id: 'other' } })) } }),
    },
  };
};

const indexed = ['false_120363402133099473@g.us_ACAF63_167474247016533@lid'];

const download = (fakeWindow, overrides = {}, resolveTimeoutMs = 10000) => {
  patchMediaDownload(resolveTimeoutMs);
  return Message.prototype.downloadMedia.call({
    hasMedia: true,
    client: createFakeClient(fakeWindow),
    id: { ...fakeWindow.message.id, _serialized: indexed[0] },
    ...overrides,
  });
};

describe('patchMediaDownload', () => {
  it('downloads through the serialized id when the collection still indexes it', async () => {
    const fakeWindow = createFakeMediaWindow({ indexedKeys: indexed });

    const media = await download(fakeWindow);

    expect(media).toMatchObject({ mimetype: 'image/jpeg', data: 'BASE64DATA', filesize: 96945 });
    expect(fakeWindow.calls.getMessagesById).toBe(0);
  });

  it('falls back to the three part key the older builds used', async () => {
    const fakeWindow = createFakeMediaWindow({ indexedKeys: ['false_120363402133099473@g.us_ACAF63'] });

    await expect(download(fakeWindow)).resolves.toMatchObject({ data: 'BASE64DATA' });
    expect(fakeWindow.calls.get).toEqual([indexed[0], 'false_120363402133099473@g.us_ACAF63']);
  });

  it('scans the chat collection when no key resolves, instead of hitting IndexedDB', async () => {
    const fakeWindow = createFakeMediaWindow({ indexedKeys: [], models: ['other', 'match'] });

    await expect(download(fakeWindow)).resolves.toMatchObject({ data: 'BASE64DATA' });
    // reaching this is what produced the opaque `t: t` in production
    expect(fakeWindow.calls.getMessagesById).toBe(0);
  });

  // The stock downloadMedia answers undefined when there is nothing to fetch, and the controllers
  // turn that into 200 + messageMedia: null. A caller that checked for null must keep working.
  it('answers no media when the message is not in the page collection', async () => {
    const fakeWindow = createFakeMediaWindow({ indexedKeys: [], models: ['other'] });

    await expect(download(fakeWindow)).resolves.toBeUndefined();
  });

  it('answers no media for a message that carries no mediaData', async () => {
    const fakeWindow = createFakeMediaWindow({ indexedKeys: indexed, mediaData: null });

    await expect(download(fakeWindow)).resolves.toBeUndefined();
  });

  it('takes the blob the page decrypted instead of decrypting a second time', async () => {
    const fakeWindow = createFakeMediaWindow({ indexedKeys: indexed });

    await expect(download(fakeWindow)).resolves.toMatchObject({ data: 'BASE64DATA' });
    expect(fakeWindow.calls.downloadManager).toBe(0);
  });

  it('prefers WhatsApp own media cache when it holds the file', async () => {
    const fakeWindow = createFakeMediaWindow({ indexedKeys: indexed, cached: { arrayBuffer: async () => new ArrayBuffer(8) } });

    await expect(download(fakeWindow)).resolves.toMatchObject({ data: 'BASE64DATA' });
    // the cache already had it, so the page was never asked to fetch
    expect(fakeWindow.calls.asked).toBe(0);
  });

  it('ignores a cache entry that is not readable as a blob', async () => {
    // the same cache keys upload FormData under the filehash
    const fakeWindow = createFakeMediaWindow({ indexedKeys: indexed, cached: { append: () => {} } });

    await expect(download(fakeWindow)).resolves.toMatchObject({ data: 'BASE64DATA' });
    expect(fakeWindow.calls.asked).toBe(1);
  });

  it('fetches again when the stage says RESOLVED but the cache was evicted', async () => {
    const fakeWindow = createFakeMediaWindow({ indexedKeys: indexed, mediaStage: 'RESOLVED' });

    await expect(download(fakeWindow)).resolves.toMatchObject({ data: 'BASE64DATA' });
    expect(fakeWindow.calls.asked).toBe(1);
  });

  it('waits REUPLOADING out without asking again', async () => {
    const fakeWindow = createFakeMediaWindow({ indexedKeys: indexed, mediaStage: 'REUPLOADING' });

    await expect(download(fakeWindow, {}, 50)).rejects.toThrow('media did not resolve in time');
    // the page is already re-uploading; a second ask would only pile on
    expect(fakeWindow.calls.asked).toBe(0);
  });

  it('keeps waiting when mediaData disappears mid-download instead of throwing', async () => {
    const fakeWindow = createFakeMediaWindow({ indexedKeys: indexed });
    fakeWindow.message.downloadMedia = async () => {
      fakeWindow.calls.asked++;
      fakeWindow.message.mediaData = null;
    };

    await expect(download(fakeWindow, {}, 50)).rejects.toThrow('media did not resolve in time');
    expect(fakeWindow.calls.asked).toBeGreaterThan(0);
  });

  it('reports the stage when the page could not fetch the media', async () => {
    const fakeWindow = createFakeMediaWindow({ indexedKeys: indexed, stageAfterDownload: 'ERROR_FILE_GONE' });

    await expect(download(fakeWindow)).rejects.toThrow('the page could not fetch the media');
  });

  it('answers no media rather than an error when the server no longer holds it', async () => {
    const fakeWindow = createFakeMediaWindow({ indexedKeys: indexed, stageAfterDownload: 'ERROR_FILE_GONE' });
    fakeWindow.message.downloadMedia = async () => {
      fakeWindow.calls.asked++;
      fakeWindow.message.mediaData.mediaStage = 'ERROR_FILE_GONE';
      const error = new Error('not found');
      error.status = 404;
      throw error;
    };

    await expect(download(fakeWindow)).resolves.toBeUndefined();
  });

  it('surfaces the real error when the blob cannot be read', async () => {
    const fakeWindow = createFakeMediaWindow({ indexedKeys: indexed });
    fakeWindow.blob.arrayBuffer = async () => {
      throw new Error('detached ArrayBuffer');
    };

    await expect(download(fakeWindow)).rejects.toThrow('reading the decrypted media failed');
  });

  // The deadline is only checked between awaits. A dropped media request never settles, so without
  // the race inside the loop the evaluate would hang forever holding the request.
  it('gives up on the deadline even when the page never answers', async () => {
    const fakeWindow = createFakeMediaWindow({ indexedKeys: indexed });
    fakeWindow.message.downloadMedia = () => {
      fakeWindow.calls.asked++;
      return new Promise(() => {});
    };

    await expect(download(fakeWindow, {}, 50)).rejects.toThrow('media did not resolve in time');
  }, 10000);

  it('does nothing for a message without media', async () => {
    const fakeWindow = createFakeMediaWindow({ indexedKeys: indexed });

    await expect(download(fakeWindow, { hasMedia: false })).resolves.toBeUndefined();
    expect(fakeWindow.calls.get).toEqual([]);
  });
});

describe('applyPagePatches', () => {
  const renamed = () => createFakeWindow({ widField: '$1', msgKeyField: '$1' });

  beforeEach(() => {
    Message.prototype.downloadMedia = stockDownloadMedia;
  });

  it('leaves the stock downloadMedia alone on a healthy build', async () => {
    await applyPagePatches(createFakeClient(createFakeWindow()), 'test', 'true');

    expect(Message.prototype.downloadMedia).toBe(stockDownloadMedia);
  });

  it('engages the media override once the build renamed the ids', async () => {
    await applyPagePatches(createFakeClient(renamed()), 'test', 'true');

    expect(Message.prototype.downloadMedia).not.toBe(stockDownloadMedia);
  });

  it('keeps the override engaged on the next ready of the same page', async () => {
    const fakeWindow = renamed();
    await applyPagePatches(createFakeClient(fakeWindow), 'test', 'true');
    Message.prototype.downloadMedia = stockDownloadMedia;

    // the page still carries the id patch, so the probe reports `already applied`
    await applyPagePatches(createFakeClient(fakeWindow), 'test', 'true');

    expect(Message.prototype.downloadMedia).not.toBe(stockDownloadMedia);
  });

  it('force engages it even on a healthy build', async () => {
    await applyPagePatches(createFakeClient(createFakeWindow()), 'test', 'force');

    expect(Message.prototype.downloadMedia).not.toBe(stockDownloadMedia);
  });

  it('false never engages it', async () => {
    await applyPagePatches(createFakeClient(renamed()), 'test', 'false');

    expect(Message.prototype.downloadMedia).toBe(stockDownloadMedia);
  });

  it('never rejects, even when the page evaluate throws', async () => {
    const client = {
      pupPage: {
        evaluate: async () => {
          throw new Error('Execution context was destroyed');
        },
      },
    };

    await expect(applyPagePatches(client, 'test', 'true')).resolves.toBeUndefined();
    expect(Message.prototype.downloadMedia).toBe(stockDownloadMedia);
  });
});
