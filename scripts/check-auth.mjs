import {loadAuthConfig} from '../server/auth-config.mjs';
try{
 const providers=loadAuthConfig();
 console.log(process.env.AUTH_CONFIG_FILE?'Authentication config is valid. Enabled connections: '+providers.length:'External authentication is disabled (AUTH_CONFIG_FILE is empty).');
 for(const p of providers)console.log(p.id+' | '+p.type+' | '+p.label+' | autoProvision='+p.autoProvision+' | sessionMinutes='+p.sessionMinutes);
}catch(error){console.error('Authentication config invalid:',error.message);process.exitCode=1;}
