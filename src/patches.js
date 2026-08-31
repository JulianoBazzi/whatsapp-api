// Compatibility shims for WhatsApp Web builds that whatsapp-web.js does not handle yet.
// Revalidate this whole file on every whatsapp-web.js bump: each patch here works around a bug in a
// specific build pair, and a library that fixed it makes the patch dead weight at best.
// Ported from avoylenko/wwebjs-api PR #150.
const { Message, MessageMedia } = require('whatsapp-web.js');
const { mediaResolveTimeoutMs, patchMediaDownloadEnabled } = require('./config');
const { logger } = require('./logger');

// WhatsApp Web 2.3000.x builds minify the serialized id field of Wid/MsgKey away from `_serialized`
// (`$1` in the builds reported upstream). Every `id._serialized` read then yields undefined:
// window.WWebJS.sendMessage ends with `Msg.get(undefined)` and returns nothing, so
// `client.sendMessage()` resolves to undefined for a message that was in fact delivered. The same
// rename strips ids from the message, chat and contact payloads, and from the webhooks.
// Wid and MsgKey are renamed independently and the alias is minifier output, so each class is probed
// on its own and the alias is discovered by value rather than assumed to be named `$1`.
// On a healthy build this is a no-op: both probes report `exposes _serialized` and nothing is touched.
// NOTE: the callback is serialized and evaluated in the browser — it must not reference module scope.
const patchSerializedIds = async client => {
  return await client.pupPage.evaluate(() => {
    if (window.__wwebjsApiSerializedIds) {
      return { applied: false, reason: 'already applied' };
    }

    // The alias holds the same value `_serialized` used to hold, so the probe finds it by
    // recognising the serialized value instead of relying on a name the minifier picked.
    const findAlias = (probe, isSerialized) => {
      const names = Object.keys(probe).concat(Object.getOwnPropertyNames(Object.getPrototypeOf(probe) || {}));
      for (const name of names) {
        if (name === '_serialized' || name === 'constructor') {
          continue;
        }
        let value;
        try {
          value = probe[name];
        } catch {
          continue;
        }
        if (typeof value === 'string' && isSerialized(value)) {
          return name;
        }
      }
      return null;
    };

    const defineSerialized = (prototype, alias) => {
      Object.defineProperty(prototype, '_serialized', {
        configurable: true,
        get() {
          return this[alias];
        },
        set(value) {
          Object.defineProperty(this, '_serialized', { value, writable: true, enumerable: true, configurable: true });
        },
      });
    };

    // Returns what happened to one class, so a build that renamed only one of them is visible
    const restoreClass = (buildProbe, isSerialized) => {
      let probe;
      try {
        probe = buildProbe();
      } catch (error) {
        return { patched: false, reason: `unable to probe: ${error.message}` };
      }
      if (typeof probe._serialized === 'string') {
        return { patched: false, reason: 'exposes _serialized' };
      }
      const alias = findAlias(probe, isSerialized);
      if (!alias) {
        return { patched: false, reason: 'no _serialized and no alias found' };
      }
      const prototype = Object.getPrototypeOf(probe);
      if (!prototype || Object.getOwnPropertyDescriptor(prototype, '_serialized')) {
        return { patched: false, reason: 'prototype is not patchable' };
      }
      defineSerialized(prototype, alias);
      return { patched: true, alias };
    };

    const createWid = jid => window.require('WAWebWidFactory').createWid(jid);
    const wid = restoreClass(
      () => createWid('0@c.us'),
      value => value === '0@c.us',
    );
    // The probe id is also the value of the key's own `id` field, so the serialized one is the field
    // that carries the id inside a longer string
    const msgKey = restoreClass(
      () => {
        const MsgKey = window.require('WAWebMsgKey');
        return new MsgKey({ from: createWid('0@c.us'), to: createWid('0@c.us'), id: 'WWEBJSAPIPROBE', selfDir: 'out' });
      },
      value => value.includes('WWEBJSAPIPROBE') && value.length > 'WWEBJSAPIPROBE'.length,
    );

    const aliases = [wid.alias, msgKey.alias].filter(Boolean);
    if (!aliases.length) {
      return { applied: false, reason: 'nothing to restore', wid, msgKey };
    }

    // Models are plain copies handed over to node, so they need the field set explicitly. The guard
    // is an own-property check rather than `typeof value._serialized`: once the prototype getter
    // above is installed a live instance answers that with a string, so no own property would be
    // written — and puppeteer only serializes own enumerable properties on the way back to node.
    const restoreSerialized = (value, depth) => {
      if (!value || typeof value !== 'object' || depth > 6) {
        return value;
      }
      if (Array.isArray(value)) {
        for (const item of value) {
          restoreSerialized(item, depth + 1);
        }
        return value;
      }
      if (!Object.hasOwn(value, '_serialized')) {
        for (const alias of aliases) {
          if (typeof value[alias] === 'string') {
            value._serialized = value[alias];
            break;
          }
        }
      }
      for (const key of Object.keys(value)) {
        restoreSerialized(value[key], depth + 1);
      }
      return value;
    };

    const models = [];
    for (const name of ['getMessageModel', 'getChatModel', 'getContactModel']) {
      const getModel = window.WWebJS[name];
      if (typeof getModel !== 'function') {
        continue;
      }
      window.WWebJS[name] = function (...args) {
        const model = getModel.apply(this, args);
        return model instanceof Promise ? model.then(resolved => restoreSerialized(resolved, 0)) : restoreSerialized(model, 0);
      };
      models.push(name);
    }

    // The guard and the patches are wiped together: both live on the page, and whatsapp-web.js only
    // re-injects window.WWebJS when it finds the page came back without it. If that invariant ever
    // breaks, the surviving prototype getters would make both probes report `exposes _serialized`,
    // `aliases` would come back empty, and we would return `nothing to restore` above without ever
    // reinstalling the model wrappers.
    window.__wwebjsApiSerializedIds = true;
    return { applied: true, wid, msgKey, models };
  });
};

// WhatsApp Web 2.3000.x indexes the Msg collection under a key whatsapp-web.js no longer agrees on,
// so `Msg.get(serializedId)` misses for every message that is not already in memory. The library
// then falls back to `Msg.getMessagesById()`, whose IndexedDB lookup rejects the id with
// `DataError: Failed to execute 'get' on 'IDBObjectStore'`. That class is minified, so puppeteer
// recovers nothing but its name and the whole thing reaches the API as the opaque `t: t`.
// Resolve the message ourselves — never reaching the IndexedDB fallback — and let the page own the
// crypto, so every failure names its own cause instead of a minified class name.
// Ported from avoylenko/wwebjs-api PR #152, with the deadline fix noted inside the loop.
// NOTE: Message.prototype is process-global. This runs from a per-session `ready`, but it patches
// downloadMedia for every session at once. That is fine — the override reads this.client.pupPage.
const patchMediaDownload = (resolveTimeoutMs = mediaResolveTimeoutMs) => {
  Message.prototype.downloadMedia = async function () {
    if (!this.hasMedia) {
      return undefined;
    }

    const result = await this.client.pupPage.evaluate(
      async (id, resolveTimeoutMs) => {
        const attempt = read => {
          try {
            return read();
          } catch {
            return null;
          }
        };
        const { Msg } = window.require('WAWebCollections');

        // The serialized form changed shape between builds (a trailing `_out`, a participant for
        // group messages), so try what the page handed us and the classic three-part key before
        // giving up on the index.
        let msg = null;
        let resolvedBy = null;
        for (const [via, key] of [
          ['serialized', id._serialized],
          ['threePart', `${id.fromMe}_${id.remote}_${id.id}`],
        ]) {
          if (!key) {
            continue;
          }
          msg = attempt(() => Msg.get(key));
          if (msg) {
            resolvedBy = via;
            break;
          }
        }
        // The chat keeps its own collection, and that is the one the library already reads to hand
        // this message to the caller — so it holds the message even when the global index does not.
        // Match on the raw id, which no build has renamed. Linear scan, bounded by the messages
        // loaded for one chat.
        if (!msg) {
          const chat = await (async () => {
            try {
              return await window.WWebJS.getChat(id.remote, { getAsModel: false });
            } catch {
              return null;
            }
          })();
          const msgs = (chat?.msgs && attempt(() => chat.msgs.getModelsArray())) || [];
          msg = msgs.find(m => m?.id?.id === id.id) || null;
          if (msg) {
            resolvedBy = 'chatScan';
          }
        }
        if (!msg) {
          return { failed: { reason: 'message is not in the page collection' } };
        }
        if (!msg.mediaData) {
          return { failed: { reason: 'message carries no mediaData', resolvedBy } };
        }

        // The page drops `mediaData` off the message while it is working on it, so reading the stage
        // straight through crashes the download. Treat it as a stage like any other and keep waiting.
        const stageOf = () => msg.mediaData?.mediaStage || 'GONE';
        const describe = error => ({ name: error?.name, message: error?.message, status: error?.status ?? null });

        // Never re-decrypt the media ourselves. `downloadManager.downloadAndMaybeDecrypt` has to be
        // fed `directPath`/`encFilehash`/`mediaKey`, and once the page has run a media retry those
        // live on `msg.mediaObject`, not on the message — so the stale key off `msg` decrypts to
        // garbage and WhatsApp's own sniffer answers `InvalidMediaFileType`, or a `hmac mismatch`
        // when it gets that far. `msg.downloadMedia()` already decrypts and parks the blob in
        // WhatsApp's own cache, so take it from there. The cache also stores upload FormData under
        // the same key, so only take an entry we can actually read as a blob.
        const readBlob = () => {
          const cached = attempt(() => window.require('WAWebMediaInMemoryBlobCache').InMemoryMediaBlobCache.get(msg.mediaObject?.filehash));
          if (cached && typeof cached.arrayBuffer === 'function') {
            return cached;
          }
          const mediaBlob = msg.mediaObject?.mediaBlob;
          return (mediaBlob && attempt(() => mediaBlob.forceToBlob())) || null;
        };

        // Asking once is not enough: when several media arrive in one batch the request goes nowhere
        // and the stage never moves, so passively polling can only time out. Ask again on every
        // round instead. The stage is never used to skip the call: cache eviction leaves `RESOLVED`
        // behind with no blob to read.
        let resolveAttempts = 0;
        let lastResolveError = null;
        let blob = readBlob();
        const deadline = Date.now() + resolveTimeoutMs;
        const failure = reason => ({ failed: { reason, mediaStage: stageOf(), resolvedBy, resolveAttempts, ...(lastResolveError ? describe(lastResolveError) : {}) } });

        while (!blob) {
          if (Date.now() > deadline) {
            return failure('media did not resolve in time');
          }
          // `REUPLOADING` means the media expired and the sender is uploading it again — the page is
          // already on it and a second ask would only pile on, so wait that stage out instead.
          if (stageOf() !== 'REUPLOADING') {
            resolveAttempts++;
            try {
              // The deadline is only checked between awaits, and a dropped media request never
              // settles — without this race the timeout would not bound anything and the evaluate
              // would hang forever, holding the request (and, on the webhook path, a listener).
              await Promise.race([msg.downloadMedia({ downloadEvenIfExpensive: true, rmrReason: 1, isUserInitiated: true }), new Promise(resolve => setTimeout(resolve, 2000))]);
            } catch (error) {
              lastResolveError = error;
            }
          }
          if (stageOf().includes('ERROR')) {
            return failure('the page could not fetch the media');
          }
          blob = readBlob();
          if (blob) {
            break;
          }
          await new Promise(resolve => setTimeout(resolve, 500));
        }

        try {
          return {
            media: {
              data: await window.WWebJS.arrayBufferToBase64Async(await blob.arrayBuffer()),
              mimetype: msg.mimetype,
              filename: msg.filename,
              filesize: msg.size,
            },
          };
        } catch (error) {
          return { failed: { reason: 'reading the decrypted media failed', mediaStage: stageOf(), resolvedBy, resolveAttempts, ...describe(error) } };
        }
      },
      this.id,
      resolveTimeoutMs,
    );

    if (result.failed) {
      const { reason, ...details } = result.failed;
      logger.warn({ messageId: this.id._serialized, ...details }, `Media download failed: ${reason}`);
      // 404 is how the library reports media the server no longer holds — keep that answering
      // "no media" rather than an error.
      if (details.status === 404) {
        return undefined;
      }
      throw new Error(`media download failed: ${reason}`);
    }
    const { data, mimetype, filename, filesize } = result.media;
    return new MessageMedia(mimetype, data, filename, filesize);
  };
};

// Runs on every `ready`, because the page-side half of the patch lives on WhatsApp Web's own
// prototypes and a page reload wipes it. Never rejects: the caller is an EventEmitter listener, and
// a rejection there would surface as an unhandled rejection.
const applyPagePatches = async (client, sessionId) => {
  if (patchMediaDownloadEnabled) {
    patchMediaDownload();
  }
  try {
    const result = await patchSerializedIds(client);
    logger.info({ sessionId, ...result }, 'Serialized id patch');
  } catch (error) {
    logger.error({ sessionId, err: error }, 'Failed to patch serialized ids');
  }
};

module.exports = {
  patchSerializedIds,
  patchMediaDownload,
  applyPagePatches,
};
