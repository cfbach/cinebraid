/* Loaded only by the EV2-5 disposable browser suite, in its server child. */
const refuse = () => { throw new Error('EV2-5 fixture blocks all server outbound requests'); };
global.fetch = async () => refuse();
for (const name of ['http','https']) { const mod = require(name); mod.request = refuse; mod.get = refuse; }
