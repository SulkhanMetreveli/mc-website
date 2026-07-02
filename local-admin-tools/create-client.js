#!/usr/bin/env node
/**
 * Met Capital Client Portal — create a client account
 *
 * LOCAL / ADMIN USE ONLY. This script uses the Supabase service role key,
 * which has full access to your database and bypasses Row Level Security.
 * Never expose this key in the public /clients frontend, and never run
 * this script from anywhere other than your own machine.
 *
 * Usage:
 *   node create-client.js --email client@example.com --name "Jane Client" [--reference MC-00123] [--password "TempPass123!"]
 *
 * If --password is omitted, a strong random temporary password is generated.
 * The client will be required to change it on first login.
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
  // 16 random bytes -> base64url, trimmed to a readable 20-char temp password.
  return crypto.randomBytes(16).toString('base64url').slice(0, 20) + '!1';
}

async function main() {
  const args = parseArgs();

  if (!args.email || !args.name) {
    console.error('Usage: node create-client.js --email <email> --name "<full name>" [--reference <ref>] [--password <temp password>]');
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
  const fullName = args.name;
  const reference = args.reference || null;
  const password = args.password || generatePassword();

  console.log('Creating auth user for ' + email + ' …');

  const { data: userData, error: userError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true
  });

  if (userError) {
    console.error('Failed to create user:', userError.message);
    process.exit(1);
  }

  const userId = userData.user.id;

  const { error: profileError } = await supabase.from('client_profiles').insert({
    user_id: userId,
    full_name: fullName,
    email,
    client_reference: reference,
    must_change_password: true,
    status: 'active'
  });

  if (profileError) {
    console.error('User was created in Auth but the profile row failed:', profileError.message);
    console.error('You can insert it manually in the Supabase Table Editor, client_profiles table, user_id = ' + userId);
    process.exit(1);
  }

  console.log('');
  console.log('Client account created successfully.');
  console.log('----------------------------------------');
  console.log('Name:        ' + fullName);
  console.log('Username:    ' + email);
  console.log('Password:    ' + password);
  console.log('Reference:   ' + (reference || '(none set)'));
  console.log('Login URL:   https://met.capital/clients/login/');
  console.log('----------------------------------------');
  console.log('Send these credentials to the client over a secure channel (not plain email');
  console.log('if avoidable — a phone call or secure message is safer). They will be required');
  console.log('to set their own password the first time they log in.');
}

main();
