#!/usr/bin/env node
/**
 * Met Capital Client Portal — reset a client's password
 *
 * LOCAL / ADMIN USE ONLY. Same rules as create-client.js: this uses the
 * Supabase service role key, which bypasses Row Level Security. Never run
 * this anywhere other than your own machine.
 *
 * Usage:
 *   node reset-password.js --email client@example.com [--password "NewTempPass123!"]
 *
 * If --password is omitted, a strong random temporary password is
 * generated. The client will be required to set their own on next login.
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

function parseArgs() {
  const args = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const value = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      args[key] = value;
    }
  }
  return args;
}

function generatePassword() {
  return crypto.randomBytes(16).toString('base64url').slice(0, 20) + '!1';
}

async function main() {
  const args = parseArgs();

  if (!args.email) {
    console.error('Usage: node reset-password.js --email <email> [--password <new temp password>]');
    process.exit(1);
  }

  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Copy .env.example to .env and fill it in.');
    process.exit(1);
  }

  const supabase = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  const email = args.email;
  const password = args.password || generatePassword();

  console.log('Looking up ' + email + ' …');

  // Supabase JS v2 doesn't have a direct "get user by email" admin call,
  // so page through listUsers() to find them.
  let user = null;
  let page = 1;
  while (!user) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) {
      console.error('Failed to list users:', error.message);
      process.exit(1);
    }
    user = data.users.find((u) => u.email && u.email.toLowerCase() === email.toLowerCase());
    if (user || data.users.length < 200) break;
    page++;
  }

  if (!user) {
    console.error('No user found with email ' + email);
    process.exit(1);
  }

  const { error: updateError } = await supabase.auth.admin.updateUserById(user.id, { password });
  if (updateError) {
    console.error('Failed to update password:', updateError.message);
    process.exit(1);
  }

  const { error: profileError } = await supabase
    .from('client_profiles')
    .update({ must_change_password: true })
    .eq('user_id', user.id);

  if (profileError) {
    console.error('Password was reset but must_change_password flag failed to update:', profileError.message);
  }

  console.log('');
  console.log('Password reset successfully.');
  console.log('----------------------------------------');
  console.log('Username:    ' + email);
  console.log('New temporary password: ' + password);
  console.log('----------------------------------------');
  console.log('Send this to the client over a secure channel. They will be required to set');
  console.log('their own password the first time they log in with it.');
}

main();
