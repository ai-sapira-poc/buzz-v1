// Real Chromium interaction.
//
// Two modes, because the tester needs both. Given a file, it renders a local
// artifact with networking denied — the original use, for checking a design
// deliverable in isolation. Given a `http://localhost:...` URL, it drives the
// real app running on this machine, with requests to any other host still
// aborted: the point is to exercise our product, not to give an agent a browser
// onto the internet.
const {chromium} = require('../../desktop/node_modules/@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const {createHash, randomUUID} = require('node:crypto');
(async () => {
  const [file, root, encoded] = process.argv.slice(2);
  const steps = JSON.parse(encoded);
  if (!Array.isArray(steps) || steps.length > 24) throw Error('Browser request must contain at most 24 steps; no partial execution');
  const browser = await chromium.launch({headless: true});
  try {
    const page = await browser.newPage();
    const live = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(file);
    await page.route('**/*', route => {
      const url = route.request().url();
      const local = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?/.test(url)
        || url.startsWith('data:') || url.startsWith('blob:');
      return live && local ? route.continue() : route.abort();
    });
    let source = '';
    if (live) {
      await page.goto(file, {waitUntil: 'domcontentloaded', timeout: 15000});
      // The evidence hash covers whatever was actually rendered. For a live
      // page that is the served DOM, not a file on disk — hashing the URL
      // would attest to nothing.
      source = await page.content();
    } else {
      source = fs.readFileSync(file, 'utf8');
      await page.setContent(source);
    }
    const results = [];
    for (const step of steps) {
      const locator = page.locator(step.selector);
      try {
        if (step.action === 'click') await locator.click({timeout: 3000});
        else if (step.action === 'fill') await locator.fill(step.value, {timeout: 3000});
        else if (step.action === 'select') await locator.selectOption(step.value, {timeout: 3000});
        else if (step.action === 'press') {
          if (!['Tab','Shift+Tab','Enter','Space','ArrowUp','ArrowDown','Escape'].includes(step.value)) throw Error('Unsupported key');
          await locator.press(step.value, {timeout: 3000});
        } else if (!['text','inspect'].includes(step.action)) throw Error('Unsupported browser action');
        results.push({action: step.action, selector: step.selector,
          text: await locator.textContent({timeout: 3000}),
          visible: await locator.isVisible(), enabled: await locator.isEnabled(),
          state: await locator.evaluate(el => ({value: el.value ?? null,
            focused: document.activeElement === el,
            valid: el.validity?.valid ?? null, validationMessage: el.validationMessage ?? null}))});
      } catch (error) {
        results.push({action: step.action, selector: step.selector, error: error.message});
        break;
      }
    }
    const screenshot = path.join(root, `browser-evidence-${randomUUID()}.png`);
    await page.screenshot({path: screenshot});
    process.stdout.write(JSON.stringify({title: await page.title(), text: await page.locator('body').innerText(), results, screenshot,
      source_sha256: createHash('sha256').update(source).digest('hex'),
      screenshot_sha256: createHash('sha256').update(fs.readFileSync(screenshot)).digest('hex'),
      fresh_page: true, requested_steps: steps.length, executed_steps: results.length,
      succeeded: results.length === steps.length && results.every(r => !r.error)}));
  } finally { await browser.close(); }
})().catch(error => {console.error(error.message); process.exitCode = 1;});
