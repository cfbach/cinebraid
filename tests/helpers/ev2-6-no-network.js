/* Child fixture server only. Blocks ordinary HTTP provider clients. This is not
   an OS firewall; isolated credentials and browser request guards also apply. */
'use strict';
const refuse=()=>{throw Error('EV2-6 synthetic fixture blocks server outbound HTTP');};
global.fetch=async()=>refuse();
for(const name of ['http','https']){const module=require(name);module.request=refuse;module.get=refuse;}
