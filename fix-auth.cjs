const fs = require('fs');
const file = 'd:/APEC/Work/Projects/MANAGER ALL/public/app.js';
let content = fs.readFileSync(file, 'utf8');

const regex = /async function initializeGoogleAuth\(\) \{[\s\S]*?\n\}/;

const newFunc = `async function initializeGoogleAuth() {
  const button = $('#googleLoginBtn');
  if (!button) return;
  if (!window.ApecSupabase?.isConfigured()) {
    console.warn('Supabase is not configured. Google Login might not work.');
    button.classList.remove('hidden');
    button.disabled = false;
    return;
  }

  try {
    state.supabase = await window.ApecSupabase.getClient();
    button.classList.remove('hidden');
    button.disabled = false;
  } catch (error) {
    console.error('Failed to initialize Supabase client:', error);
    button.classList.remove('hidden');
    button.disabled = true;
    button.title = 'Cannot connect to Auth provider';
  }
}`;

content = content.replace(regex, newFunc);
fs.writeFileSync(file, content, 'utf8');
console.log('Replaced initializeGoogleAuth successfully');
