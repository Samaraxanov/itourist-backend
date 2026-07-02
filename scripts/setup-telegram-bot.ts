import 'dotenv/config';

// Configures the Telegram bot to launch the Mini App from its menu button.
// Run after starting a public HTTPS tunnel/deploy:
//   TELEGRAM_WEBAPP_URL=https://xxxx.ngrok-free.app npm run bot:setup
//
// No long-running bot process is required — the menu button opens the web app
// directly. (You can still add a polling bot later for /start replies, etc.)

const token = process.env.TELEGRAM_BOT_TOKEN;
const url = process.env.TELEGRAM_WEBAPP_URL;

if (!token) {
  console.error('✖ TELEGRAM_BOT_TOKEN is not set in .env');
  process.exit(1);
}
if (!url || !url.startsWith('https://')) {
  console.error('✖ TELEGRAM_WEBAPP_URL must be a public https:// URL (a tunnel or deploy).');
  console.error('  e.g. TELEGRAM_WEBAPP_URL=https://xxxx.ngrok-free.app npm run bot:setup');
  process.exit(1);
}

const api = (method: string, body: unknown) =>
  fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => r.json());

async function main() {
  const me = await api('getMe', {});
  if (!me.ok) throw new Error(`getMe failed: ${JSON.stringify(me)}`);
  console.log(`Bot: @${me.result.username}`);

  // Menu button → launches the Mini App.
  const menu = await api('setChatMenuButton', {
    menu_button: { type: 'web_app', text: 'Open iTourist', web_app: { url } },
  });
  console.log('setChatMenuButton:', menu.ok ? '✔' : JSON.stringify(menu));

  // Slash commands shown in the bot menu.
  const cmds = await api('setMyCommands', {
    commands: [{ command: 'start', description: 'Open the iTourist app' }],
  });
  console.log('setMyCommands:', cmds.ok ? '✔' : JSON.stringify(cmds));

  const desc = await api('setMyDescription', {
    description: 'iTourist — manage your tour firm, tours and bookings right inside Telegram.',
  });
  console.log('setMyDescription:', desc.ok ? '✔' : JSON.stringify(desc));

  console.log(`\nDone. Open @${me.result.username} in Telegram and tap the menu button to launch the app at:\n  ${url}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
