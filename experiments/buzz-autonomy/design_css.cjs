// Parse CSS rather than matching declarations with regular expressions.
const postcss = require('../../desktop/node_modules/postcss');
const fs = require('node:fs');
try {
  const {css, tokens} = JSON.parse(fs.readFileSync(0, 'utf8'));
  const known = new Set(tokens);
  for (const source of css) {
    const root = postcss.parse(source);
    root.walkAtRules(rule => {
      if (!['media', 'keyframes', 'font-face', 'supports'].includes(rule.name)) throw Error(`Unsupported @${rule.name}`);
    });
    root.walkDecls(d => {
      if (d.prop.startsWith('--')) throw Error('Custom token overrides require a reviewed Sapira derivation');
      if (/[\\]|!important/i.test(d.value) || d.important) throw Error('Escaped/important overrides are unavailable');
      for (const [, token] of d.value.matchAll(/var\((--[\w-]+)\)/g)) {
        if (!known.has(token)) throw Error(`Unknown Sapira token: ${token}`);
      }
      const fontFace = d.parent.type === 'atrule' && d.parent.name === 'font-face';
      if (fontFace) {
        if (d.prop === 'font-family' && !/^['"]?DM (Sans|Mono)['"]?$/.test(d.value)) throw Error('Use the Sapira font');
        if (d.prop === 'src' && !/^url\(["']?data:font\/woff2;base64,[a-zA-Z0-9+/=]+["']?\)(?: format\(["']woff2["']\))?$/.test(d.value)) throw Error('Embed the self-hosted Sapira font');
        return;
      }
      const visual = /color|background|shadow|radius|font|^(fill|stroke|border|outline)(-|$)|^(padding|margin|gap)(-|$)/.test(d.prop);
      if (visual) {
        // Geometric border widths and zero/auto layout remain legal. Visual
        // values must otherwise be canonical vars, not literals or fallbacks.
        const rest = d.value.replace(/var\(--[\w-]+\)/g, '').replace(/\b(?:none|inherit|transparent|currentColor|solid|dashed|auto|normal)\b/g, '').replace(/\b0(?:px|rem)?\b/g, '').trim();
        const geometry = /^(?:border|outline)(?:-(?:top|right|bottom|left|width|offset))?$/.test(d.prop);
        const fontSize = d.prop === 'font-size';
        if (rest && !(geometry && /^\d+(?:px|rem)$/.test(rest)) && !(fontSize && /^\d*\.?\d+rem$/.test(rest))) {
          throw Error(`Use Sapira tokens for ${d.prop}: ${d.value}`);
        }
      }
    });
  }
  process.stdout.write(JSON.stringify({passed: true, scope: 'foundation-only'}));
} catch (error) { process.stderr.write(error.message); process.exitCode = 1; }
