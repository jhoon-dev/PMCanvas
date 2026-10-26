import {createPool} from '../server/postgres.mjs';
import {emailAddress} from '../server/security.mjs';
const [email,confirm]=process.argv.slice(2);
if(confirm!=='--confirm-reset')throw Error('Operator recovery only: node scripts/reset-mfa.mjs admin-email --confirm-reset. Invalidates all administrator sessions and MFA recovery codes.');
const pool=await createPool(),c=await pool.connect();
try{await c.query('BEGIN');const user=(await c.query('SELECT id FROM pm_users WHERE email=$1 AND is_admin FOR UPDATE',[emailAddress(email)])).rows[0];if(!user)throw Error('Administrator not found.');
 await c.query('DELETE FROM pm_admin_mfa WHERE user_id=$1',[user.id]);await c.query('DELETE FROM pm_sessions WHERE user_id=$1',[user.id]);await c.query('DELETE FROM pm_auth_transient WHERE value->>\'userId\'=$1',[user.id]);
 await c.query("INSERT INTO pm_security_events(actor_id,kind,details) VALUES ($1,'auth.mfa.reset.operator','{}')",[user.id]);await c.query('COMMIT');console.log('MFA reset. Enroll again at the next password login.');
}catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();await pool.end();}
