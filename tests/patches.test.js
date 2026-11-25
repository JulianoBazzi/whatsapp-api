import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { patchSerializedIds, applyPagePatches, cancelPairingCode } = require('../src/patches');

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

describe('applyPagePatches', () => {
  it('applies the serialized id patch on a renamed build', async () => {
    const fakeWindow = createFakeWindow({ widField: '$1', msgKeyField: '$1' });
    await applyPagePatches(createFakeClient(fakeWindow), 'test');

    expect(newMsgKey(fakeWindow)._serialized).toBe('true_123@c.us_ABCD_out');
  });

  it('never rejects, even when the page evaluate throws', async () => {
    const client = {
      pupPage: {
        evaluate: async () => {
          throw new Error('Execution context was destroyed');
        },
      },
    };

    await expect(applyPagePatches(client, 'test')).resolves.toBeUndefined();
  });
});

// The logged-out page either still has WAWebLaunchSocketUtils (the / route) or only the backend event
// bus (the /login/ route of 2.3000.1055852612+); `launchSocket: false` builds the latter.
const createFakePairingWindow = ({ launchSocket = true } = {}) => {
  const calls = { refreshQR: 0, triggerRefreshQR: 0, initializeQRLinking: 0 };
  const modules = {
    WAWebLaunchSocketUtils: launchSocket ? { refreshQR: () => calls.refreshQR++ } : null,
    WAWebBackendEventBus: { BackendEventBus: { triggerRefreshQR: () => calls.triggerRefreshQR++ } },
    WAWebAltDeviceLinkingApi: { initializeQRLinking: async () => calls.initializeQRLinking++ },
  };
  return { calls, codeInterval: setInterval(() => {}, 60000), require: name => modules[name] };
};

describe('cancelPairingCode', () => {
  it('refreshes the QR through the backend event bus on the /login/ route', async () => {
    const fakeWindow = createFakePairingWindow({ launchSocket: false });
    await cancelPairingCode(createFakeClient(fakeWindow));

    expect(fakeWindow.calls).toEqual({ refreshQR: 0, triggerRefreshQR: 1, initializeQRLinking: 1 });
    expect(fakeWindow.codeInterval).toBeUndefined();
  });

  it('keeps using WAWebLaunchSocketUtils where it still exists', async () => {
    const fakeWindow = createFakePairingWindow();
    await cancelPairingCode(createFakeClient(fakeWindow));

    expect(fakeWindow.calls).toEqual({ refreshQR: 1, triggerRefreshQR: 0, initializeQRLinking: 1 });
    expect(fakeWindow.codeInterval).toBeUndefined();
  });
});

// whatsapp-web.js 1.34.8 ships upstream 064a3d5 (#201923), which 1.2.3 had to apply as a pnpm patch:
// processMediaData() hands back a MediaData model whose private `__x_id` is spread into the outgoing
// message and overwrites the Msg id, so without it every media send dies with "Data passed to getter
// must include an id property". The function source is what whatsapp-web.js serializes into the page, so
// asserting on it catches a bump or a downgrade that loses the fix here instead of in production.
describe('whatsapp-web.js media id fix', () => {
  it('strips the MediaData __x_id before the message is sent', () => {
    const { LoadUtils } = require('whatsapp-web.js/src/util/Injected/Utils');

    expect(LoadUtils.toString()).toContain('delete message.__x_id');
  });
});

// patches/whatsapp-web.js@1.34.8.patch (upstream 38eb45b, #201990): since WhatsApp Web 2.3000.1055852612
// a logged-out page lands on /login/, where `WAWebSocketModel` is null, so inject() waited on a socket
// state that never came and no `qr` or `code` event ever fired — no new device could link. The patch
// reads the state from `WAWebBackendEventBus`, which exists on both routes.
describe('whatsapp-web.js login route patch', () => {
  it('reads the socket state from the backend event bus', () => {
    const source = require('node:fs').readFileSync(require.resolve('whatsapp-web.js/src/Client.js'), 'utf8');

    expect(source).toContain("window.location.pathname.startsWith('/login')");
    expect(source).toContain('BackendEventBus.socketState');
  });
});
