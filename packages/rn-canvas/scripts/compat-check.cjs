/**
 * Vérification de compatibilité sur une app Expo de test (modèle par défaut d'un SDK) :
 *
 *   node scripts/compat-check.cjs <dossier de l'app> <texte d'un élément de l'accueil> <préfixe des captures>
 *
 * L'app doit déjà être préparée (rn-canvas init, Expo lancé avec RN_CANVAS=1, `rn-canvas dev --no-app`
 * sur le port 7007). Le scénario : chargement des écrans, sélection, palette, poignée de rayon
 * (écriture puis annulation du code), mode Flux. Nécessite Playwright.
 */
const { chromium } = require('playwright');
const { execSync } = require('child_process');

const [dir, sample, prefix = 'compat'] = process.argv.slice(2);
const log = (...a) => console.log(new Date().toTimeString().slice(0, 8), ...a);
const diff = () => execSync(`git -C "${dir}" diff --stat -- . ':!rn-canvas.stories.ts' ':!canvas/parcours.json'`, { encoding: 'utf8' }).trim() || '(aucun changement)';

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  const result = { loaded: false, selected: null, palette: false, handles: 0, written: false, undone: false, flows: null, storyErrors: [] };
  try {
    await page.goto('http://localhost:7007/');
    await page.waitForSelector('.pages-bar');
    try {
      await page.waitForSelector('.canvas-progress', { timeout: 30000 });
      await page.waitForSelector('.canvas-progress', { state: 'detached', timeout: 600000 });
    } catch {}
    result.loaded = true;
    await page.waitForTimeout(3000);
    result.storyErrors = await page.locator('.frame-error').allTextContents();
    await page.click('.zoom-controls button[title="Tout afficher"]');
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${prefix}-1-canevas.png` });

    // Zoom sur le premier écran, puis sélection d'un élément.
    const title = await page.locator('.artboard iframe').first().getAttribute('title');
    const frame = page.frameLocator(`iframe[title="${title}"]`);
    const box = await page.locator(`iframe[title="${title}"]`).boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 3);
    await page.keyboard.down('Control');
    for (let i = 0; i < 6; i++) {
      await page.mouse.wheel(0, -20);
      await page.waitForTimeout(80);
    }
    await page.keyboard.up('Control');
    await page.waitForTimeout(800);
    await frame.getByText(sample).first().click();
    await page.waitForTimeout(2500);
    result.selected = await page.locator('.element-name').textContent().catch(() => null);
    result.palette = (await page.locator('.sel-palette').count()) > 0;
    const handles = frame.locator('[data-rn-canvas-overlay] [title]');
    result.handles = await handles.count();
    await page.screenshot({ path: `${prefix}-2-selection.png` });

    // Poignée de rayon : écrit dans le code, puis annulation.
    const radius = frame.locator('[data-rn-canvas-overlay] [title^="Rayon des coins"]').first();
    if (await radius.count()) {
      const h = await radius.boundingBox();
      await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
      await page.mouse.down();
      for (let i = 1; i <= 8; i++) await page.mouse.move(h.x + h.width / 2 + i * 3, h.y + h.height / 2 + i * 3);
      await page.mouse.up();
      await page.waitForTimeout(3000);
      const d = diff();
      result.written = d !== '(aucun changement)';
      log('rayon →', d);
      await page.screenshot({ path: `${prefix}-3-rayon.png` });
      await page.keyboard.press('Escape');
      const undo = page.locator('.history button').first();
      if (await undo.isEnabled()) await undo.click();
      await page.waitForTimeout(2000);
      result.undone = diff() === '(aucun changement)';
    }

    await page.click('button:has-text("Flux")');
    await page.click('.zoom-controls button[title="Tout afficher"]');
    await page.waitForTimeout(5000);
    result.flows = await page.locator('.flow-legend strong').first().textContent().catch(() => null);
    await page.screenshot({ path: `${prefix}-4-flux.png` });
  } catch (e) {
    log('échec', String(e).slice(0, 300));
  }
  log(JSON.stringify({ ...result, errors }));
  await browser.close();
})();
