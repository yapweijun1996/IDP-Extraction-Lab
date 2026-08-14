import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const url = process.env.IDP_LAB_QA_URL || "http://127.0.0.1:4174/";
const executablePath = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const multiPagePdf = process.env.IDP_LAB_MULTIPAGE_PDF || "";
const browser = await chromium.launch({ executablePath, headless: true });
const viewports = [[390, 844], [430, 932], [768, 1024], [834, 1112], [1024, 768], [1280, 800], [1440, 900]];
const results = [];
try {
  for (const [width, height] of viewports) {
    const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: "allow" });
    const page = await context.newPage(), errors = [];
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(url, { waitUntil: "networkidle" });
    await page.waitForSelector("#pageImage[src]", { state: "attached" });
    assert.equal(await page.title(), "IDP Extraction Lab");
    assert.equal(await page.locator(".security-banner").count(), 0, "Top BYOK banner should not be rendered");
    assert.match(await page.locator(".brand-logo").getAttribute("src"), /assets\/idp-extraction-lab-logo(?:-[A-Za-z0-9_-]+)?\.png$/, "Official Lab logo should be used in the header");
    assert.ok(await page.locator("svg.ui-icon").count() >= 12, "inline SVG registry icons should be hydrated");
    assert.equal(await page.locator("[data-icon] svg").count(), await page.locator("[data-icon]").count(), "every static icon slot should contain an SVG");
    assert.equal(await page.locator("#providerButton svg.ui-icon-settings").count(), 1, "Provider should use the settings gear SVG");
    assert.equal(await page.locator(".language-icon svg.ui-icon-language").count(), 1, "Language selector should use the language SVG");
    for (const selector of ["#selectDocumentButton", "#providerButton", "#runButton", "#exportButton", "#previousPage", "#nextPage", "#zoomOut", "#zoomIn", "#fullscreenButton"]) {
      assert.equal(await page.locator(`${selector} svg`).count(), 1, `${selector} should use one inline SVG icon`);
    }
    const visibleGlyphs = await page.locator(".icon-slot, .mini-action, .row-status, .thumbnail-preview, .spinner").evaluateAll((elements) => elements.some((element) => /[＋⚙▷⇩⌃⌄‹›−⛶⌁×⌕↑↓✓↻○]/u.test(element.textContent || "")));
    assert.equal(visibleGlyphs, false, "icon-bearing controls must not render legacy Unicode glyphs");
    assert.ok(await page.locator(".mini-action.move-field svg").count() > 0, "field move controls should use SVG arrows");
    assert.ok(await page.locator(".mini-action.remove-field svg").count() > 0, "field remove controls should use SVG trash icons");
    const languageSelect = page.locator("#languageSelect");
    await languageSelect.waitFor({ state: "visible" });
    assert.deepEqual(await languageSelect.locator("option").evaluateAll((options) => options.map((option) => option.value)), ["en", "zh-CN", "ms", "ja", "vi"]);
    const languageSelectStyles = await languageSelect.evaluate((select) => { const style = getComputedStyle(select); return { color: style.color, fontSize: style.fontSize, textIndent: style.textIndent }; });
    assert.equal(languageSelectStyles.color, "rgba(0, 0, 0, 0)", "Closed language control must keep native select text transparent");
    assert.equal(languageSelectStyles.fontSize, "0px", "Closed language control must not show the selected locale label beside the SVG");
    assert.match(languageSelectStyles.textIndent, /-9999px/, "Closed language control must move native selected text out of the icon surface");
    assert.equal(await page.locator("body").evaluate((body) => body.scrollWidth <= document.documentElement.clientWidth), true, `${width} has horizontal overflow`);
    assert.equal(await page.getByRole("button", { name: /Add Field/ }).first().isVisible(), true);
    if (width < 1200) {
      await page.getByRole("button", { name: "Document", exact: true }).click();
      assert.equal(await page.locator(".document-pane").isVisible(), true);
      await page.getByRole("button", { name: "Fields", exact: true }).click();
    }
    if (width === 1280) {
      const fieldKeysBeforeLanguage = await page.locator(".fields-pane .key-chip").allTextContents();
      for (const [value, expectedTitle] of [["zh-CN", "要抽取什么"], ["ms", "Apa yang Hendak Diekstrak"], ["ja", "抽出する情報"], ["vi", "Thông tin cần trích xuất"], ["en", "What to Extract"]]) {
        await languageSelect.selectOption(value);
        assert.equal(await page.locator("html").getAttribute("lang"), value);
        assert.equal(await page.locator("#fieldsTitle").innerText(), expectedTitle);
        assert.deepEqual(await page.locator(".fields-pane .key-chip").allTextContents(), fieldKeysBeforeLanguage, "Language switching must not change extraction fields");
      }
      await page.evaluate(() => localStorage.setItem("idp-extraction-lab-layout-v1", JSON.stringify({ version: 1, widths: { fields: 26, document: 44, result: 30 }, hidden: { fields: true, document: true, result: false } })));
      await page.reload({ waitUntil: "networkidle" });
      await page.waitForSelector("#pageImage[src]", { state: "attached" });
      const fieldKeysBefore = await page.locator(".fields-pane .key-chip").allTextContents();
      await page.locator("#layoutButton").click();
      const fieldsToggle = page.locator('[data-layout-pane="fields"]');
      const documentToggle = page.locator('[data-layout-pane="document"]');
      const resultToggle = page.locator('[data-layout-pane="result"]');
      assert.equal(await fieldsToggle.isChecked(), false, "Persisted hidden Fields state should survive reload");
      assert.equal(await documentToggle.isChecked(), false, "Persisted hidden Document state should survive reload");
      assert.equal(await resultToggle.isChecked(), true, "Persisted visible Result state should survive reload");
      await fieldsToggle.click();
      assert.equal(await page.locator(".fields-pane").isVisible(), true, "Showing Fields should not show other hidden panes");
      assert.equal(await page.locator(".document-pane").isVisible(), false);
      assert.equal(await page.locator(".result-pane").isVisible(), true);
      await documentToggle.click();
      assert.equal(await page.locator(".document-pane").isVisible(), true, "Document should show independently");
      assert.equal(await page.locator(".fields-pane").isVisible(), true);
      assert.equal(await page.locator(".result-pane").isVisible(), true);
      await resultToggle.click();
      assert.equal(await page.locator(".result-pane").isVisible(), false, "Result should hide independently");
      assert.deepEqual(await page.locator(".fields-pane .key-chip").allTextContents(), fieldKeysBefore, "Layout toggles must not change extraction fields");
      await resultToggle.click();
      await page.locator("#closeLayoutMenu").click();
    }
    await page.locator("#providerButton").click();
    assert.equal(await page.getByRole("heading", { name: "BYOK Provider" }).isVisible(), true);
    const providerModal = page.locator("#providerDrawer .provider-modal");
    const providerContent = page.locator("#providerDrawer .provider-modal-content");
    const providerFooter = page.locator("#providerDrawer .provider-actions");
    const modalBox = await providerModal.boundingBox();
    const headerBox = await page.locator("#providerDrawer .modal-header").boundingBox();
    const footerBox = await providerFooter.boundingBox();
    assert.ok(modalBox && headerBox && footerBox, `${width} Provider modal layers should be measurable`);
    if (width <= 640) {
      assert.ok(Math.abs(modalBox.width - width) <= 2, `${width} Provider modal should fill mobile width`);
      assert.ok(Math.abs(modalBox.height - height) <= 2, `${width} Provider modal should fill mobile height`);
    } else {
      assert.ok(Math.abs(modalBox.width - Math.min(720, width - 48)) <= 2, `${width} Provider modal width should be centered and bounded`);
      assert.ok(Math.abs(modalBox.height - height * 0.8) <= 2, `${width} Provider modal should use 80vh`);
      assert.ok(Math.abs((modalBox.x + modalBox.width / 2) - width / 2) <= 2, `${width} Provider modal should be horizontally centered`);
      assert.ok(Math.abs((modalBox.y + modalBox.height / 2) - height / 2) <= 2, `${width} Provider modal should be vertically centered`);
    }
    const providerLayerStyles = await page.locator("#providerDrawer .provider-modal").evaluate((element) => ({ rows: getComputedStyle(element).gridTemplateRows, overflow: getComputedStyle(element).overflow }));
    const providerContentStyles = await providerContent.evaluate((element) => ({ overflowY: getComputedStyle(element).overflowY, minHeight: getComputedStyle(element).minHeight }));
    const providerHeaderStyles = await page.locator("#providerDrawer .modal-header").evaluate((element) => getComputedStyle(element).position);
    const providerFooterStyles = await providerFooter.evaluate((element) => getComputedStyle(element).position);
    assert.equal(providerLayerStyles.rows.trim().split(/\s+/).length, 3, "Provider modal should have header/content/footer grid rows");
    assert.equal(providerLayerStyles.overflow, "hidden");
    assert.equal(providerContentStyles.overflowY, "auto");
    assert.equal(providerContentStyles.minHeight, "0px");
    assert.equal(providerHeaderStyles, "sticky");
    assert.equal(providerFooterStyles, "sticky");
    for (const id of ["saveProvider", "testProvider", "deleteProvider"]) assert.equal(await providerFooter.locator(`#${id}`).count(), 1, `${id} should remain in the sticky Provider footer`);
    await providerModal.press("Escape");
    assert.equal(await page.locator("#providerDrawer").getAttribute("hidden"), "", `${width} Escape should close Provider modal`);
    assert.equal(await page.evaluate(() => document.activeElement?.id), "providerButton", `${width} Provider close should restore focus`);
    await page.locator("#providerButton").click();
    await page.getByRole("button", { name: "Close provider settings" }).click();
    assert.deepEqual(errors, [], `${width} console errors: ${errors.join(" | ")}`);
    results.push(`${width}x${height}: pass`);
    await context.close();
  }
  const offlineContext = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "allow" });
  const offlinePage = await offlineContext.newPage();
  await offlinePage.goto(url, { waitUntil: "networkidle" });
  await offlinePage.evaluate(() => navigator.serviceWorker.ready);
  const manifest = await offlinePage.evaluate(async () => (await fetch("./manifest.webmanifest")).json());
  assert.equal(manifest.display, "standalone");
  assert.ok(manifest.icons.every((icon) => /icons\/icon-(?:192|512)(?:-maskable)?\.png$/.test(icon.src)), "PWA manifest should use generated official-logo icons");
  const cachedProviderRequests = await offlinePage.evaluate(async () => { const names = await caches.keys(), urls = []; for (const name of names) { const cache = await caches.open(name); urls.push(...(await cache.keys()).map((request) => request.url)); } return urls.filter((cached) => cached.includes("api.openai.com") || cached.includes("generativelanguage.googleapis.com")); });
  assert.deepEqual(cachedProviderRequests, []);
  await offlineContext.setOffline(true);
  await offlinePage.reload({ waitUntil: "domcontentloaded" });
  assert.equal(await offlinePage.title(), "IDP Extraction Lab");
  await offlinePage.evaluate(() => { Object.defineProperty(navigator, "onLine", { value: false, configurable: true }); window.dispatchEvent(new Event("offline")); });
  assert.equal(await offlinePage.locator("#offlineBanner").isVisible(), true);
  await offlinePage.locator("#languageSelect").selectOption("zh-CN");
  assert.equal(await offlinePage.locator("#fieldsTitle").innerText(), "要抽取什么");
  await offlineContext.close();
  results.push("PWA offline shell/network-only provider cache: pass");
  if (multiPagePdf) {
    const documentContext = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: "allow" });
    const documentPage = await documentContext.newPage(), errors = [];
    documentPage.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    documentPage.on("pageerror", (error) => errors.push(error.message));
    await documentPage.goto(url, { waitUntil: "networkidle" });
    await documentPage.locator("#documentInput").setInputFiles(multiPagePdf);
    await documentPage.waitForFunction(() => document.querySelectorAll("#thumbnailRail .thumbnail").length > 1);
    await documentPage.waitForFunction(() => [...document.querySelectorAll("#thumbnailRail .thumbnail")].every((button) => button.getAttribute("aria-label")?.endsWith("preview ready")), null, { timeout: 30000 });
    const thumbnailCount = await documentPage.locator("#thumbnailRail .thumbnail").count();
    assert.ok(thumbnailCount > 1, "multi-page PDF should create multiple thumbnails");
    await documentPage.locator(`#thumbnailRail .thumbnail[data-page="${thumbnailCount}"]`).click();
    await documentPage.locator('#thumbnailRail .thumbnail[data-page="2"]').click();
    await documentPage.waitForFunction(() => document.querySelector("#pageImage")?.alt?.endsWith("page 2"));
    assert.equal(await documentPage.locator("#pageIndicator").innerText(), `Page 2 / ${thumbnailCount}`);
    assert.deepEqual(errors, [], `multi-page console errors: ${errors.join(" | ")}`);
    await documentContext.close();
    results.push(`Progressive thumbnails (${thumbnailCount} pages) and rapid navigation: pass`);
  }
  console.log(results.join("\n"));
} finally { await browser.close(); }
