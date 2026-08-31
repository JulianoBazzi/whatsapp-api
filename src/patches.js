// Compatibility shims for WhatsApp Web builds that whatsapp-web.js does not handle yet.
// Revalidate this whole file on every whatsapp-web.js bump: each patch here works around a bug in a
// specific build pair, and a library that fixed it makes the patch dead weight at best.
// Ported from avoylenko/wwebjs-api PR #150.
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

// Runs on every `ready`, because the page-side half of the patch lives on WhatsApp Web's own
// prototypes and a page reload wipes it. Never rejects: the caller is an EventEmitter listener, and
// a rejection there would surface as an unhandled rejection.
const applyPagePatches = async (client, sessionId) => {
  try {
    const result = await patchSerializedIds(client);
    logger.info({ sessionId, ...result }, 'Serialized id patch');
  } catch (error) {
    logger.error({ sessionId, err: error }, 'Failed to patch serialized ids');
  }
};

module.exports = {
  patchSerializedIds,
  applyPagePatches,
};
