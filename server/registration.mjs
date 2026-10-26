export function registrationConfig(env={}){
 const mode=env.REGISTRATION_MODE??'approval';
 if(!['approval','disabled'].includes(mode))throw Error('REGISTRATION_MODE must be approval or disabled.');
 const domains=(env.REGISTRATION_DOMAINS||'').split(',').map(d=>d.trim().toLowerCase()).filter(Boolean);
 if(domains.length>50||domains.some(d=>d.length>253||!/^([a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(d)))throw Error('REGISTRATION_DOMAINS must contain exact email domains, separated by commas.');
 return {mode,domains:[...new Set(domains)]};
}
