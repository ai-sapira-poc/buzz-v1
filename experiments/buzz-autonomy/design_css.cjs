// Parse CSS rather than matching declarations with regular expressions.
const postcss = require('../../desktop/node_modules/postcss');
const fs = require('node:fs');

// Report every violation in one pass, and name the tokens that would satisfy
// each one.
//
// Measured cost of not doing this: the designer burned three full assignments
// (16/16, 24/24, 16/16 iterations) discovering this gate's rules one rejected
// write at a time — `-webkit-font-smoothing`, then `margin: 0 0 4px`, then
// `gap: 0.375rem`, then `font-variant-numeric`, then `box-shadow`… Eight
// violations meant eight iterations spent learning the dialect instead of
// designing, and the budget died before the artifact existed. Its own report
// asked for exactly this: "pedir el spec exacto del gate".
//
// A gate that says only "no" teaches by attrition. One that says "no, use
// --space-component-gap" is a spec you can act on.
const FAMILIES = [
  [/^font-size$/, 'font-size'],
  // Only the typography properties that actually have tokens. A looser `^font`
  // matched `font-variant-numeric` and cheerfully recommended
  // `--font-weight-bold`, which does not satisfy it — a wrong suggestion costs
  // the agent an iteration to disprove, so it is worse than staying silent.
  [/^(?:font-weight|font-family|line-height|letter-spacing)$/, 'font'],
  [/(?:^|-)(?:color|fill|stroke)$|^background/, 'color'],
  [/^(?:padding|margin|gap)(?:-|$)|^(?:row|column)-gap$/, 'space'],
  [/radius/, 'radius'],
  [/shadow/, 'shadow'],
  [/^(?:border|outline)(?:-|$)/, 'border'],
];

function suggest(prop, known) {
  const family = FAMILIES.find(([pattern]) => pattern.test(prop));
  if (!family) return [];
  const needle = family[1];
  return [...known].filter(token => token.includes(needle)).slice(0, 6);
}

function advise(prop, value, known) {
  const options = suggest(prop, known);
  const base = `Use Sapira tokens for ${prop}: ${value}`;
  if (!options.length) {
    return `${base} — no hay token para esta propiedad; no la uses.`;
  }
  return `${base} — usa uno de: ${options.join(', ')}`;
}

try {
  const {css, tokens} = JSON.parse(fs.readFileSync(0, 'utf8'));
  const known = new Set(tokens);
  const problems = [];
  // Structural failures (a bad at-rule, an unknown token) still stop the pass:
  // they mean the stylesheet could not be understood, so the remaining
  // declarations carry no information worth collecting.
  for (const source of css) {
    const root = postcss.parse(source);
    root.walkAtRules(rule => {
      if (!['media', 'keyframes', 'font-face', 'supports'].includes(rule.name)) throw Error(`Unsupported @${rule.name}`);
    });
    root.walkDecls(d => {
      if (d.prop.startsWith('--')) {
        problems.push(`Custom token overrides require a reviewed Sapira derivation: ${d.prop}`);
        return;
      }
      if (/[\\]|!important/i.test(d.value) || d.important) {
        problems.push(`Escaped/important overrides are unavailable: ${d.prop}: ${d.value}`);
        return;
      }
      for (const [, token] of d.value.matchAll(/var\((--[\w-]+)\)/g)) {
        if (!known.has(token)) throw Error(`Unknown Sapira token: ${token}`);
      }
      const fontFace = d.parent.type === 'atrule' && d.parent.name === 'font-face';
      if (fontFace) {
        if (d.prop === 'font-family' && !/^['"]?DM (Sans|Mono)['"]?$/.test(d.value)) throw Error('Use the Sapira font');
        if (d.prop === 'src' && !/^url\(["']?data:font\/woff2;base64,[a-zA-Z0-9+/=]+["']?\)(?: format\(["']woff2["']\))?$/.test(d.value)) throw Error('Embed the self-hosted Sapira font');
        return;
      }
      // Table and background *mechanics* share a prefix with palette
      // properties but carry no colour: nothing in the token set can satisfy
      // `border-collapse: collapse`. Job diseno-tower-slice1-screen was told
      // "no hay token; no la uses" for exactly that and spent three of its
      // last six turns unable to comply. An unsatisfiable rejection is the
      // costliest kind, so these are out of scope for the gate.
      const mechanics = /^(?:border-(?:collapse|spacing|image(?:-|$))|background-(?:size|repeat|position|clip|origin|attachment|blend-mode))/.test(d.prop);
      const visual = !mechanics && /color|background|shadow|radius|font|^(fill|stroke|border|outline)(-|$)|^(padding|margin|gap)(-|$)/.test(d.prop);
      if (visual) {
        // Geometric border widths and zero/auto layout remain legal. Visual
        // values must otherwise be canonical vars, not literals or fallbacks.
        let rest = d.value.replace(/var\(--[\w-]+\)/g, '').replace(/\b(?:none|inherit|transparent|currentColor|solid|dashed|auto|normal)\b/g, '').replace(/\b0(?:px|rem)?\b/g, '').trim();
        const geometry = /^(?:border|outline)(?:-(?:top|right|bottom|left|width|offset))?$/.test(d.prop);
        const fontSize = d.prop === 'font-size';
        // A shadow is offsets + blur + spread + colour. Only the colour is a
        // palette decision; the lengths are geometry exactly like a border
        // width. Same run: `0 -1px 0 0 var(--color-border-subtle)` was
        // rejected although its only colour is a Sapira token.
        if (/shadow/.test(d.prop)) {
          rest = rest.replace(/\binset\b|,|-?\d*\.?\d+(?:px|rem)/g, '').trim();
        }
        if (rest && !(geometry && /^\d+(?:px|rem)$/.test(rest)) && !(fontSize && /^\d*\.?\d+rem$/.test(rest))) {
          problems.push(advise(d.prop, d.value, known));
        }
      }
    });
  }
  if (problems.length) {
    // Deduplicate: the same rule broken in ten places is one thing to learn,
    // and a wall of repeats buries the other violations.
    const unique = [...new Set(problems)];
    throw Error(`${unique.length} infracción(es):\n- ${unique.join('\n- ')}`);
  }
  process.stdout.write(JSON.stringify({passed: true, scope: 'foundation-only'}));
} catch (error) { process.stderr.write(error.message); process.exitCode = 1; }
