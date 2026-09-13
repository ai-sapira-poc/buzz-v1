// Verify archived relay events using the repository's installed Nostr implementation.
const {verifyEvent} = require('../../desktop/node_modules/nostr-tools');
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  const events = JSON.parse(input);
  const invalid = events.filter(event => !verifyEvent(event)).map(event => event.id);
  process.stdout.write(JSON.stringify({verified: events.length - invalid.length, invalid}));
  if (invalid.length) process.exitCode = 1;
});
