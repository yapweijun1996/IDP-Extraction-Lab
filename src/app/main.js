import { registerSW } from 'virtual:pwa-register';
import { validateContract, sanitizeProviderConfig } from '../providers/contract.mjs';
import { BrowserDocumentRenderer } from '../ui/pdf-renderer.mjs';
import { AgentRuntimeClient } from '../runtime/runtime-client.mjs';
import { normalizedHighlightBox } from '../ui/highlight-bbox.mjs';
import { ProgressiveThumbnailQueue } from '../ui/thumbnail-queue.mjs';
import { openVault, storageHealth } from '../state/vault.mjs';
import { activePaneAfterHide, boundaryValue, cloneDefaultLayout, loadLayoutState, MIN_PANE_PX, PANE_KEYS, resizeBoundary, saveLayoutState, togglePane, visiblePaneKeys } from '../state/layout-state.mjs';
import { LOCALE_META, SUPPORTED_LOCALES, loadLocale, saveLocale, translate } from '../i18n/i18n.mjs';
import { icon } from '../ui/icons.mjs';
import { safeTraceEvent, safeTraceNdjson, traceMetricsLabel } from '../runtime/telemetry.mjs';
import '../ui/g3tooltip.js';

(function () {
  'use strict';

  const SAMPLE_URL = './samples/SYN_USD_PO_TEST001.pdf';
  const SAMPLE_NAME = 'SYN_USD_PO_TEST001.pdf';
  const renderer = new BrowserDocumentRenderer();
  const groups = {
    document: [
      { label: 'Purchase Order Number', key: 'po_number', type: 'Text', required: true },
      { label: 'Purchase Order Date', key: 'po_date', type: 'Date', required: true },
      { label: 'Supplier Name', key: 'supplier_name', type: 'Text', required: true },
      { label: 'Currency', key: 'currency', type: 'Text', required: true }
    ],
    line: [
      { label: 'S/N', key: 'sn', type: 'Number', required: true },
      { label: 'Stock Code', key: 'stock_code', type: 'Text', required: true },
      { label: 'Description', key: 'description', type: 'Text', required: true },
      { label: 'Quantity', key: 'quantity', type: 'Number', required: true },
      { label: 'Unit Price', key: 'unit_price', type: 'Number', required: true },
      { label: 'Amount', key: 'amount', type: 'Number', required: true }
    ],
    total: [
      { label: 'Subtotal', key: 'subtotal', type: 'Number' },
      { label: 'GST', key: 'gst', type: 'Number' },
      { label: 'Grand Total', key: 'grand_total', type: 'Number', required: true }
    ]
  };

  const labels = { document: 'fields.document', line: 'fields.line', total: 'fields.total' };
  const suggestions = {
    document: [
      ['Purchase Order Number', 'po_number', 'Text'], ['Purchase Order Date', 'po_date', 'Date'], ['Supplier Name', 'supplier_name', 'Text'], ['Currency', 'currency', 'Text'], ['Delivery Date', 'delivery_date', 'Date'], ['Payment Terms', 'payment_terms', 'Text'], ['Delivery Address', 'delivery_address', 'Text']
    ],
    line: [
      ['S/N', 'sn', 'Number'], ['Stock Code', 'stock_code', 'Text'], ['Description', 'description', 'Text'], ['Quantity', 'quantity', 'Number'], ['Unit Price', 'unit_price', 'Number'], ['Amount', 'amount', 'Number'], ['UOM', 'uom', 'Text'], ['Barcode', 'barcode', 'Text'], ['Supplier Item Code', 'supplier_item_code', 'Text'], ['Discount', 'discount', 'Number'], ['GST Code', 'gst_code', 'Text'], ['Remarks', 'remarks', 'Text'], ['Delivery Date', 'line_delivery_date', 'Date']
    ],
    total: [
      ['Subtotal', 'subtotal', 'Number'], ['GST', 'gst', 'Number'], ['Grand Total', 'grand_total', 'Number'], ['Discount Total', 'discount_total', 'Number'], ['Tax Total', 'tax_total', 'Number'], ['Shipping', 'shipping', 'Number'], ['Service Charge', 'service_charge', 'Number'], ['Net Total', 'net_total', 'Number']
    ]
  };

  let lineItems = [];

  let activeGroup = 'document';
  let dialogMode = 'suggested';
  let labelTouched = false;
  let currentPage = 1;
  let currentLinePage = 1;
  let selectedRow = null;
  let zoom = 100;
  let extractState = 'idle';
  let previousFocus = null;
  let selectedDocument = null;
  let activeRunId = '';
  let activeResult = null;
  let activeEvaluation = null;
  let pageCount = 1;
  let telemetrySeq = 0;
  let agentEvents = [];
  let pagePreviewUrls = new Map();
  let pagePreviewPromises = new Map();
  let thumbnailStates = new Map();
  let documentGeneration = 0;
  let pageRequestSequence = 0;
  let vault = null;
  let providerConfig = { provider: 'gemini', model: 'gemini-3.5-flash-lite', reasoning: 'medium' };
  let runtime = null;
  let storageWarning = '';
  let runArtifacts = [];
  let runStartedAt = 0;
  let layoutState = loadLayoutState();
  let paneResizeState = null;
  let layoutMenuSyncing = false;
  let locale = loadLocale();
  let updateSW = null;
  let updateRegistration = null;
  let pwaUpdateState = 'READY';
  let pwaUpdateCheckAt = 0;
  let pwaUpdateRetryTimer = null;
  let pwaUpdateReloading = false;
  let pwaControllerChangeHandler = null;

  const $ = (id) => document.getElementById(id);
  const t = (key, variables = {}) => {
    const value = translate(key, variables, locale);
    return ['fields.add', 'contract.addField'].includes(key) ? value.replace(/^\s*\+\s*/, '') : value;
  };
  const iconMarkup = (name, options = {}) => icon(name, options);
  const fieldMessageKey = Object.freeze({
    po_number: 'field.po_number', po_date: 'field.po_date', supplier_name: 'field.supplier_name', currency: 'field.currency',
    sn: 'field.sn', stock_code: 'field.stock_code', description: 'field.description', quantity: 'field.quantity', unit_price: 'field.unit_price', amount: 'field.amount',
    subtotal: 'field.subtotal', gst: 'field.gst', grand_total: 'field.grand_total'
  });
  const fieldLabel = (field) => fieldMessageKey[field?.key] ? t(fieldMessageKey[field.key]) : String(field?.label || '');
  const groupLabel = (group) => t(labels[group] || group);
  const localeName = (value) => LOCALE_META[value]?.nativeLabel || LOCALE_META.en.nativeLabel;

  const els = {
    workspace: $('workspace'), fieldGroups: $('fieldGroups'), advancedToggle: $('advancedToggle'), advancedBody: $('advancedBody'), advancedPrompt: $('advancedPrompt'), promptCount: $('promptCount'),
    runButton: $('runButton'), emptyRunButton: $('emptyRunButton'), exportButton: $('exportButton'), fileStatus: $('fileStatus'), rowCount: $('rowCount'), fileName: $('fileName'), pageCountMeta: $('pageCountMeta'), documentInput: $('documentInput'), selectDocumentButton: $('selectDocumentButton'),
    emptyState: $('emptyState'), errorState: $('errorState'), errorMessage: $('errorMessage'), errorStep: $('errorStep'), retryRunButton: $('retryRunButton'), viewFailureTrace: $('viewFailureTrace'), processingState: $('processingState'), completedResult: $('completedResult'), processingTitle: $('processingTitle'), progressText: $('progressText'), processingDetail: $('processingDetail'), progressBar: $('progressBar'), compactSummary: $('compactSummary'),
    documentFields: $('documentFields'), documentStatusMark: $('documentStatusMark'), lineItemHeaders: $('lineItemHeaders'), lineItemRows: $('lineItemRows'), mobileLineItems: $('mobileLineItems'), rowSearch: $('rowSearch'), paginationSummary: $('paginationSummary'), linePage: $('linePage'), lineItemCount: $('lineItemCount'), totalsList: $('totalsList'), financialCheck: $('financialCheck'), financialExpression: $('financialExpression'), financialStatus: $('financialStatus'),
    pageImage: $('pageImage'), pageIndicator: $('pageIndicator'), thumbnailRail: $('thumbnailRail'), pageFrame: $('pageFrame'), documentHighlight: $('documentHighlight'), documentStage: $('documentStage'),
    fieldDialog: $('fieldDialog'), dialog: document.querySelector('#fieldDialog .dialog'), dialogTitle: $('dialogTitle'), suggestedMode: $('suggestedMode'), customMode: $('customMode'), fieldSearch: $('fieldSearch'), suggestedFields: $('suggestedFields'),
    customLabel: $('customLabel'), customKey: $('customKey'), customType: $('customType'), customRequired: $('customRequired'), labelError: $('labelError'), keyError: $('keyError'),
    issuesDrawer: $('issuesDrawer'), issuesPanel: document.querySelector('#issuesDrawer .issues-drawer'), issueList: $('issueList'), traceList: $('traceList'), evaluationSummary: $('evaluationSummary'), downloadTrace: $('downloadTrace'), issuesButton: $('issuesButton'), elapsedSummary: $('elapsedSummary'), pagesSummary: $('pagesSummary'), toast: $('toast'),
    dataTab: $('dataTab'), jsonTab: $('jsonTab'), dataPanel: $('dataPanel'), jsonPanel: $('jsonPanel'), jsonOutput: $('jsonOutput'), offlineBanner: $('offlineBanner'),
    layoutButton: null, layoutMenu: null, closeLayoutMenu: null, resetLayoutButton: null, languageSelect: null,
    pwaUpdateBanner: $('pwaUpdateBanner'), pwaUpdateMessage: $('pwaUpdateMessage'), pwaUpdateButton: $('pwaUpdateButton'), pwaUpdateOverlay: $('pwaUpdateOverlay')
  };

  function setFirstText(element, value) {
    if (!element) return;
    const textNode = [...element.childNodes].find((node) => node.nodeType === Node.TEXT_NODE);
    if (textNode) textNode.nodeValue = value;
    else element.insertBefore(document.createTextNode(value), element.firstChild);
  }

  function hydrateStaticIcons() {
    document.querySelectorAll('[data-icon]').forEach((element) => {
      const name = element.dataset.icon;
      if (!name) return;
      element.replaceChildren();
      element.appendChild(document.createRange().createContextualFragment(iconMarkup(name, { className: 'static-icon' })));
    });
  }

  function applyStaticTranslations() {
    const text = {
      '.brand strong': 'app.title', '.brand small': 'app.subtitle', '#selectDocumentButton .upload-label': 'action.selectDocument', '#providerButton .provider-label': 'action.provider', '#runButton .run-label': 'action.runExtraction', '#exportButton .export-label': 'action.export', '#downloadTrace .download-trace-label': 'issues.downloadTrace',
      '.workspace-tabs [data-view="fields"]': 'tabs.fields', '.workspace-tabs [data-view="document"]': 'tabs.document', '.workspace-tabs [data-view="result"]': 'tabs.result', '#fieldsTitle': 'fields.title', '.fields-pane .pane-title p': 'fields.help', '#viewerTitle': 'viewer.title', '#dataTab': 'result.data', '#jsonTab': 'result.json', '#emptyState h2': 'empty.title', '#emptyState p': 'empty.help', '#emptyRunButton': 'empty.run', '#advancedBody > label': 'advanced.label', '#resultTitle': 'empty.title', '#issuesTitle': 'issues.title', '#issuesDrawer .issues-drawer > header p': 'issues.help', '#issuesDrawer .drawer-scroll > h3:nth-of-type(1)': 'issues.issues', '#issuesDrawer .drawer-scroll > h3:nth-of-type(2)': 'issues.activity', '#issuesDrawer .drawer-scroll > h3:nth-of-type(3)': 'issues.localRun', '#providerTitle': 'provider.title', '#providerDrawer .provider-modal > header p': 'provider.help', '#providerDrawer .byok-warning strong': 'provider.internal', '#providerDrawer .byok-warning p': 'provider.warning', '#completedResult .document-card h2': 'result.document', '#completedResult .totals-card h2': 'result.totals', '#financialCheck h2': 'result.financialCheck', '#copyJson': 'result.copy', '#downloadJson': 'result.download'
    };
    Object.entries(text).forEach(([selector, key]) => { const element = document.querySelector(selector); if (element) element.textContent = t(key); });
    document.querySelectorAll('[data-i18n]').forEach((element) => { if (!element.closest('#advancedToggle')) element.textContent = t(element.dataset.i18n); });
    const advancedLabel = document.querySelector('#advancedToggle span:first-child');
    setFirstText(advancedLabel, `${t('fields.advanced')} `);
    const advancedOptional = advancedLabel?.querySelector('small'); if (advancedOptional) advancedOptional.textContent = t('fields.optional');
    setFirstText(document.querySelector('#layoutButton .layout-label'), t('layout.button'));
    setFirstText(document.querySelector('#layoutMenu #layoutTitle'), t('layout.title'));
    const layoutHelp = document.querySelector('#layoutMenu .layout-help'); if (layoutHelp) layoutHelp.textContent = t('layout.help');
    document.querySelectorAll('[data-layout-pane]').forEach((input) => { const label = input.closest('label')?.querySelector('span'); if (label) label.textContent = t(`layout.${input.dataset.layoutPane}`); });
    const layoutReset = document.querySelector('#resetLayoutButton'); if (layoutReset) layoutReset.textContent = t('layout.reset');
    const closeLayout = document.querySelector('#closeLayoutMenu'); if (closeLayout) { closeLayout.setAttribute('aria-label', t('layout.close')); closeLayout.title = t('layout.close'); }
    const providerLabels = [['#providerDrawer .provider-form > label:nth-of-type(1)', 'provider.name'], ['#providerDrawer .provider-form > label:nth-of-type(2)', 'provider.model'], ['#providerDrawer .provider-form > label:nth-of-type(3)', 'provider.reasoning'], ['#providerDrawer .provider-form > label:nth-of-type(4)', 'provider.key']];
    providerLabels.forEach(([selector, key]) => setFirstText(document.querySelector(selector), t(key)));
    const providerActions = [['#providerDrawer .provider-modal-content > h3', 'provider.localData'], ['#refreshHistory', 'provider.refreshHistory'], ['#clearLocalData', 'provider.clearData'], ['#saveProvider', 'provider.save'], ['#testProvider', 'provider.test'], ['#deleteProvider', 'provider.delete']];
    providerActions.forEach(([selector, key]) => { const element = document.querySelector(selector); if (element) element.textContent = t(key); });
    const providerSelectOptions = [['#providerSelect option[value="gemini"]', 'provider.gemini'], ['#providerSelect option[value="openai"]', 'provider.openai']];
    providerSelectOptions.forEach(([selector, key]) => { const element = document.querySelector(selector); if (element) element.textContent = t(key); });
    const closeProvider = document.querySelector('#closeProvider'); if (closeProvider) { closeProvider.setAttribute('aria-label', t('accessibility.closeProvider')); closeProvider.title = t('accessibility.closeProvider'); }
    const keyInput = document.querySelector('#providerKey'); if (keyInput) keyInput.placeholder = t('provider.keyPlaceholder');
    const credentialStatus = document.querySelector('#credentialStatus'); if (credentialStatus && !credentialStatus.dataset.runtimeText) credentialStatus.textContent = t('provider.noKey');
    const storageStatus = document.querySelector('#storageStatus'); if (storageStatus && !storageStatus.dataset.runtimeText) storageStatus.textContent = t('provider.storageChecking');
    const customLabels = [['#customMode > label:nth-of-type(1)', 'contract.fieldLabel'], ['#customMode > label:nth-of-type(2)', 'contract.jsonKey'], ['#customMode > label:nth-of-type(3)', 'contract.fieldType']];
    customLabels.forEach(([selector, key]) => setFirstText(document.querySelector(selector), t(key)));
    setFirstText(document.querySelector('#customMode .required-toggle strong'), t('contract.required'));
    const requiredHelp = document.querySelector('#customMode .required-toggle small'); if (requiredHelp) requiredHelp.textContent = t('contract.requiredHelp');
    const createCustom = document.querySelector('#createCustomButton .create-custom-label'); if (createCustom) createCustom.textContent = t('contract.createCustom');
    const backButton = document.querySelector('#backToSuggested'); if (backButton) backButton.textContent = t('contract.back');
    const closeDialog = document.querySelector('#closeDialog'); if (closeDialog) closeDialog.setAttribute('aria-label', t('accessibility.closeDialog'));
    const dialogHelp = document.querySelector('#dialogHelp'); if (dialogHelp) dialogHelp.textContent = t('contract.suggested');
    const suggestedTitle = document.querySelector('#suggestedMode > h3'); if (suggestedTitle) suggestedTitle.textContent = t('contract.suggested');
    if (els.offlineBanner) els.offlineBanner.textContent = t('status.offline');
    if (els.pwaUpdateButton) {
      els.pwaUpdateButton.setAttribute('aria-label', t('pwa.updateNow'));
      els.pwaUpdateButton.title = t('pwa.updateNow');
    }
    if (els.pwaUpdateOverlay) els.pwaUpdateOverlay.setAttribute('aria-label', t('pwa.updating'));
    const jsonCaption = document.querySelector('.line-items-card table caption'); if (jsonCaption) jsonCaption.textContent = t('result.lineItems', { count: lineItems.length });
    document.querySelectorAll('.workspace-tabs button').forEach((button) => { button.textContent = t(`tabs.${button.dataset.view}`); });
    const attributes = {
      '.brand': ['aria-label', 'app.title'], '.workspace-tabs': ['aria-label', 'accessibility.workspaceViews'], '.viewer-controls': ['aria-label', 'accessibility.documentControls'], '#thumbnailRail': ['aria-label', 'accessibility.documentPages'], '.result-tabs': ['aria-label', 'accessibility.resultFormat'], '.search-control input': ['placeholder', 'result.search'], '#selectDocumentButton': ['aria-label', 'action.selectDocument'], '#providerButton': ['aria-label', 'action.provider'], '#runButton': ['aria-label', 'action.runExtraction'], '#exportButton': ['aria-label', 'action.export'], '#previousPage': ['aria-label', 'viewer.previous'], '#nextPage': ['aria-label', 'viewer.next'], '#zoomOut': ['aria-label', 'viewer.zoomOut'], '#zoomIn': ['aria-label', 'viewer.zoomIn'], '#fitButton': ['aria-label', 'viewer.fit'], '#fullscreenButton': ['aria-label', 'viewer.fullscreen'], '#advancedPrompt': ['placeholder', 'advanced.placeholder'], '#rowSearch': ['placeholder', 'result.search'], '#offlineBanner': ['aria-label', 'status.offline'], '#issuesButton': ['aria-label', 'issues.title'], '#documentStage': ['aria-label', 'viewer.preview'], '#languageSelect': ['aria-label', 'language.select'], '#pwaUpdateBanner': ['aria-label', 'pwa.updateAvailable'], '#pwaUpdateOverlay': ['aria-label', 'pwa.updating']
    };
    Object.entries(attributes).forEach(([selector, [attribute, key]]) => { const element = document.querySelector(selector); if (element) element.setAttribute(attribute, t(key)); });
    document.title = t('app.title');
    document.documentElement.lang = locale;
    if (els.languageSelect) { els.languageSelect.setAttribute('aria-label', t('language.select')); els.languageSelect.title = t('language.select'); }
    hydrateStaticIcons();
  }

  function installLanguageDom() {
    const topActions = document.querySelector('.top-actions');
    if (!topActions || els.languageSelect) return;
    const wrapper = document.createElement('label');
    wrapper.className = 'language-control';
    wrapper.innerHTML = `<span class="icon-slot language-icon" data-icon="language" aria-hidden="true"></span><span class="sr-only" id="languageLabel"></span><select id="languageSelect"></select>`;
    topActions.insertBefore(wrapper, topActions.querySelector('#runButton'));
    els.languageSelect = wrapper.querySelector('#languageSelect');
    els.languageSelect.innerHTML = SUPPORTED_LOCALES.map((value) => `<option value="${value}">${escapeHtml(localeName(value))}</option>`).join('');
    els.languageSelect.value = locale;
    els.languageSelect.addEventListener('change', () => {
      locale = saveLocale(els.languageSelect.value);
      applyStaticTranslations();
      renderFieldGroups(); renderSuggestions(); renderDocumentFields(); renderLineItems(); renderTotals(); renderIssuesAndTrace(activeResult); updateJson();
      showToast(t('language.label') + ': ' + localeName(locale));
    });
    applyStaticTranslations();
  }

  function installLayoutDom() {
    const topActions = document.querySelector('.top-actions');
    const panes = { fields: document.querySelector('.fields-pane'), document: document.querySelector('.document-pane'), result: document.querySelector('.result-pane') };
    if (!topActions || Object.values(panes).some((pane) => !pane)) return;
    PANE_KEYS.forEach((key) => panes[key].dataset.pane = key);
    const resizers = [document.createElement('div'), document.createElement('div')];
    resizers.forEach((resizer, index) => {
      resizer.className = 'pane-resizer';
      resizer.dataset.resizer = index === 0 ? 'primary' : 'secondary';
      resizer.setAttribute('role', 'separator');
      resizer.setAttribute('aria-orientation', 'vertical');
      resizer.setAttribute('aria-label', t('layout.resize'));
      resizer.setAttribute('tabindex', '0');
      resizer.title = t('layout.dragResize');
    });
    panes.fields.after(resizers[0]);
    panes.document.after(resizers[1]);

    const control = document.createElement('div');
    control.className = 'layout-control';
    control.innerHTML = `<button class="button secondary" id="layoutButton" type="button" aria-label="${escapeHtml(t('layout.button'))}" title="${escapeHtml(t('layout.button'))}" aria-haspopup="dialog" aria-expanded="false"><span class="icon-slot" data-icon="layout" aria-hidden="true"></span><span class="layout-label">${escapeHtml(t('layout.button'))}</span></button><div class="layout-menu" id="layoutMenu" role="dialog" aria-labelledby="layoutTitle" hidden><header><h2 id="layoutTitle">${escapeHtml(t('layout.title'))}</h2><button class="icon-button" id="closeLayoutMenu" type="button" aria-label="${escapeHtml(t('layout.close'))}"><span class="icon-slot" data-icon="close" aria-hidden="true"></span></button></header><p class="layout-help">${escapeHtml(t('layout.help'))}</p><div class="layout-options"><label><input type="checkbox" data-layout-pane="fields"><span>${escapeHtml(t('layout.fields'))}</span></label><label><input type="checkbox" data-layout-pane="document"><span>${escapeHtml(t('layout.document'))}</span></label><label><input type="checkbox" data-layout-pane="result"><span>${escapeHtml(t('layout.result'))}</span></label></div><button class="reset-layout" id="resetLayoutButton" type="button">${escapeHtml(t('layout.reset'))}</button></div>`;
    topActions.insertBefore(control, topActions.querySelector('#runButton'));
    els.layoutButton = control.querySelector('#layoutButton');
    els.layoutMenu = control.querySelector('#layoutMenu');
    els.closeLayoutMenu = control.querySelector('#closeLayoutMenu');
    els.resetLayoutButton = control.querySelector('#resetLayoutButton');
    hydrateStaticIcons();
    installLayoutListeners(resizers, panes);
    applyLayoutState();
  }

  const thumbnailQueue = new ProgressiveThumbnailQueue({
    render: (page) => renderer.render(page, 54),
    onState: (page, state, generation) => {
      if (generation !== thumbnailQueue.generation) return;
      thumbnailStates.set(page, state);
      updateThumbnailButton(page);
    }
  });

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
  }

  function normalizeKey(value) {
    let key = String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/_+/g, '_');
    if (/^[0-9]/.test(key)) key = `field_${key}`;
    return key;
  }

  function allKeys() {
    return new Set(Object.values(groups).flat().map((field) => field.key));
  }

  function renderFieldGroups() {
    els.fieldGroups.innerHTML = Object.keys(groups).map((group) => {
      const fields = groups[group];
      const sectionLabel = groupLabel(group);
      const rows = fields.length ? fields.map((field, index) => `
        <div class="field-row" draggable="true" data-group="${group}" data-index="${index}">
          <span class="drag-handle" title="${escapeHtml(t('field.drag'))}" aria-hidden="true">${iconMarkup('grip')}</span>
          <span class="field-label" title="${escapeHtml(fieldLabel(field))}">${escapeHtml(fieldLabel(field))}${field.required ? `<sup aria-label="${escapeHtml(t('accessibility.required'))}">*</sup>` : ''}</span>
          <code class="key-chip">${escapeHtml(field.key)}</code>
          <button class="mini-action move-field" type="button" data-direction="${index === fields.length - 1 ? -1 : 1}" aria-label="${escapeHtml(t(index === fields.length - 1 ? 'field.moveUp' : 'field.moveDown', { label: fieldLabel(field) }))}">${iconMarkup(index === fields.length - 1 ? 'chevronUp' : 'chevronDown')}</button>
          <button class="mini-action remove-field" type="button" aria-label="${escapeHtml(t('field.remove', { label: fieldLabel(field) }))}">${iconMarkup('trash')}</button>
        </div>`).join('') : `<div class="field-empty">${escapeHtml(t('fields.empty', { group: sectionLabel.toLowerCase() }))}</div>`;
      return `<section class="field-section" data-field-group="${group}"><button class="section-toggle" type="button" aria-expanded="true"><span>${escapeHtml(sectionLabel)}</span><span class="section-count">${fields.length}</span><span class="section-toggle-icon" aria-hidden="true">${iconMarkup('chevronUp')}</span></button><div class="section-body"><div class="field-list">${rows}</div><button class="add-field" type="button" data-add-group="${group}"><span class="icon-slot" aria-hidden="true">${iconMarkup('add')}</span><span>${escapeHtml(t('fields.add'))}</span></button></div></section>`;
    }).join('');
  }

  function renderThumbnailShell() {
    const pages = Array.from({ length: pageCount }, (_, index) => index + 1);
    thumbnailStates = new Map(pages.map((page) => [page, { status: 'pending' }]));
    els.thumbnailRail.innerHTML = pages.map((page) => `<button type="button" class="thumbnail${page === currentPage ? ' active' : ''}" data-page="${page}" aria-label="${escapeHtml(t('viewer.openPage', { page, status: t('viewer.previewWaiting') }))}" aria-current="${page === currentPage ? 'page' : 'false'}"><span class="thumbnail-preview"><span class="thumbnail-pending" aria-hidden="true">${iconMarkup('loader', { className: 'thumbnail-icon' })}</span></span><span class="thumbnail-page">${page}</span></button>`).join('');
  }

  function updateThumbnailButton(page) {
    const button = els.thumbnailRail.querySelector(`[data-page="${Number(page)}"]`);
    if (!button) return;
    const state = thumbnailStates.get(Number(page)) || { status: 'pending' };
    const preview = button.querySelector('.thumbnail-preview');
    preview.replaceChildren();
    button.removeAttribute('aria-busy');
    if (state.status === 'ready' && state.result?.url) {
      const image = document.createElement('img'); image.src = state.result.url; image.alt = '';
      preview.appendChild(image);
      button.setAttribute('aria-label', t('viewer.openPage', { page, status: t('viewer.previewReady') }));
      return;
    }
    const marker = document.createElement('span');
    marker.className = state.status === 'loading' ? 'thumbnail-loading' : state.status === 'error' ? 'thumbnail-error' : 'thumbnail-pending';
    marker.innerHTML = iconMarkup(state.status === 'error' ? 'alert' : 'loader', { className: 'thumbnail-icon' });
    marker.setAttribute('aria-hidden', 'true'); preview.appendChild(marker);
    if (state.status === 'loading') button.setAttribute('aria-busy', 'true');
    button.setAttribute('aria-label', t('viewer.openPage', { page, status: state.status === 'error' ? t('viewer.previewFailed') : state.status === 'loading' ? t('viewer.previewLoading') : t('viewer.previewWaiting') }));
  }

  function renderThumbnails() {
    els.thumbnailRail.querySelectorAll('[data-page]').forEach((button) => {
      const active = Number(button.dataset.page) === currentPage;
      button.classList.toggle('active', active);
      button.setAttribute('aria-current', active ? 'page' : 'false');
    });
  }

  async function ensurePagePreview(page, generation = documentGeneration) {
    if (pagePreviewUrls.has(page)) return pagePreviewUrls.get(page);
    const key = `${generation}:${page}`;
    if (pagePreviewPromises.has(key)) return pagePreviewPromises.get(key);
    const promise = renderer.render(page, 108).then((rendered) => {
      if (generation !== documentGeneration) return null;
      pagePreviewUrls.set(page, rendered.url);
      return rendered.url;
    }).finally(() => pagePreviewPromises.delete(key));
    pagePreviewPromises.set(key, promise);
    return promise;
  }

  async function setDocumentPage(page) {
    const requestedPage = Math.max(1, Math.min(pageCount, Number(page)));
    const requestSequence = ++pageRequestSequence;
    const generation = documentGeneration;
    currentPage = requestedPage;
    thumbnailQueue.prioritize(requestedPage);
    els.pageIndicator.textContent = t('viewer.page', { page: requestedPage, total: pageCount });
    renderThumbnails();
    const previewUrl = await ensurePagePreview(requestedPage, generation);
    if (!previewUrl || requestSequence !== pageRequestSequence || generation !== documentGeneration || requestedPage !== currentPage) return;
    els.pageImage.src = previewUrl;
    els.pageImage.alt = t('viewer.page', { page: requestedPage, total: pageCount });
    const selectedPage = selectedRow?.source_page || selectedRow?.page;
    const localized = Boolean(selectedRow && selectedPage === currentPage && positionHighlight(selectedRow.source_bbox));
    els.documentHighlight.hidden = !localized;
  }

  function positionHighlight(bbox) {
    const position = normalizedHighlightBox(bbox);
    if (!position) {
      for (const property of ['left', 'top', 'width', 'height', 'right']) els.documentHighlight.style.removeProperty(property);
      return false;
    }
    Object.assign(els.documentHighlight.style, position);
    els.documentHighlight.style.right = 'auto';
    return true;
  }

  function setZoom(nextZoom) {
    zoom = Math.max(75, Math.min(150, nextZoom));
    $('zoomLabel').textContent = `${zoom}%`;
    els.pageFrame.classList.remove('fit');
    els.pageFrame.style.setProperty('--page-scale', String(zoom / 100));
  }

  function showToast(message) {
    els.toast.textContent = message;
    els.toast.hidden = false;
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => { els.toast.hidden = true; }, 2300);
  }

  function focusables(container) {
    return Array.from(container.querySelectorAll('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])')).filter((element) => !element.hidden);
  }

  function trapDialog(event, container, close) {
    if (event.key === 'Escape') { event.preventDefault(); close(); return; }
    if (event.key !== 'Tab') return;
    const items = focusables(container);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  function openFieldDialog(group) {
    activeGroup = group;
    dialogMode = 'suggested';
    previousFocus = document.activeElement;
    els.dialogTitle.textContent = t('contract.addDialogTitle', { group: groupLabel(group) });
    els.fieldSearch.value = '';
    els.suggestedMode.hidden = false;
    els.customMode.hidden = true;
    renderSuggestions();
    els.fieldDialog.hidden = false;
    document.body.style.overflow = 'hidden';
    window.setTimeout(() => els.fieldSearch.focus(), 0);
  }

  function closeFieldDialog() {
    els.fieldDialog.hidden = true;
    document.body.style.overflow = '';
    previousFocus?.focus();
  }

  function renderSuggestions() {
    const query = els.fieldSearch.value.trim().toLowerCase();
    const existing = allKeys();
    const options = suggestions[activeGroup].filter(([label, key]) => `${label} ${key}`.toLowerCase().includes(query));
    els.suggestedFields.innerHTML = options.length ? options.map(([label, key, type]) => { const display = fieldMessageKey[key] ? t(fieldMessageKey[key]) : label; return `<button type="button" class="suggestion" data-key="${key}" ${existing.has(key) ? 'disabled' : ''}><span><strong>${escapeHtml(display)}</strong><code>${key}</code></span><em>${existing.has(key) ? escapeHtml(t('contract.added')) : escapeHtml(type)}</em></button>`; }).join('') : `<div class="field-empty">${escapeHtml(t('contract.noMatching'))}</div>`;
  }

  function openCustomMode() {
    dialogMode = 'custom';
    labelTouched = false;
    els.suggestedMode.hidden = true;
    els.customMode.hidden = false;
    els.dialogTitle.textContent = t('contract.createCustom');
    els.customMode.reset();
    els.labelError.textContent = '';
    els.keyError.textContent = '';
    els.customLabel.removeAttribute('aria-invalid');
    els.customKey.removeAttribute('aria-invalid');
    els.customLabel.focus();
  }

  function addSuggested(key) {
    const option = suggestions[activeGroup].find((entry) => entry[1] === key);
    if (!option || allKeys().has(key)) return;
    groups[activeGroup].push({ label: option[0], key: option[1], type: option[2] });
    renderFieldGroups();
    closeFieldDialog();
    showToast(t('toast.added', { label: fieldMessageKey[option[1]] ? t(fieldMessageKey[option[1]]) : option[0] }));
  }

  function addCustomField(event) {
    event.preventDefault();
    const label = els.customLabel.value.trim();
    const key = els.customKey.value.trim().toLowerCase();
    const validKey = /^[a-z_][a-z0-9_]*$/.test(key);
    const duplicate = allKeys().has(key);
    els.labelError.textContent = label ? '' : t('contract.invalidLabel');
    els.keyError.textContent = !key ? t('contract.invalidKey') : !validKey ? t('contract.invalidKeyFormat') : duplicate ? t('contract.duplicateKey') : '';
    els.customLabel.setAttribute('aria-invalid', String(!label));
    els.customKey.setAttribute('aria-invalid', String(Boolean(els.keyError.textContent)));
    if (!label || els.keyError.textContent) return;
    groups[activeGroup].push({ label, key, type: els.customType.value, required: els.customRequired.checked });
    renderFieldGroups();
    closeFieldDialog();
    showToast(t('toast.added', { label }));
  }

  function renderDocumentFields() {
    const values = activeResult?.data?.document_fields || {};
    const statuses = [];
    els.documentFields.innerHTML = groups.document.map((field) => {
      const state = activeResult?.field_states?.document_fields?.[field.key] || {};
      const status = readableStatus(state, { requireProvenance: true });
      statuses.push(status);
      return `<div class="source-field" data-group="document_fields" data-key="${escapeHtml(field.key)}" tabindex="0"><dt>${escapeHtml(fieldLabel(field))}</dt><dd>${escapeHtml(displayValue(values[field.key]))}</dd>${statusMarkup(status)}</div>`;
    }).join('');
    const aggregateStatus = statuses.some((status) => ['Needs Review', 'Missing'].includes(status)) ? 'Needs Review' : statuses.some((status) => status === 'Reinspected') ? 'Reinspected' : 'Verified';
    updateStandaloneStatus(els.documentStatusMark, aggregateStatus);
    refreshG3Tooltips(els.documentFields);
  }

  function filteredRows() {
    const query = els.rowSearch.value.trim().toLowerCase();
    if (!query) return lineItems;
    return lineItems.filter((row) => Object.values(row).filter((value) => typeof value !== 'object').join(' ').toLowerCase().includes(query));
  }

  function statusTooltip(status) {
    return ({
      Verified: `${t('status.verified')} — ${t('status.verified')}`,
      'Needs Review': `${t('status.needsReview')} — ${t('issues.help')}`,
      Reinspected: `${t('status.reinspected')} — ${t('issues.localized')}`,
      Missing: `${t('status.missing')} — ${t('status.missing')}`,
      'Not Requested': `${t('status.notRequested')} — ${t('status.notRequested')}`
    })[status] || status;
  }

  function statusDefinition(status) {
    const cls = status === 'Reinspected' ? 'reinspected' : ['Needs Review', 'Missing'].includes(status) ? 'review' : status === 'Not Requested' ? 'not-requested' : '';
    const iconName = status === 'Reinspected' ? 'refresh' : ['Needs Review', 'Missing'].includes(status) ? 'alert' : status === 'Not Requested' ? 'dash' : 'check';
    const explanation = statusTooltip(status);
    return { cls, iconName, explanation };
  }

  function statusMarkup(status) {
    const { cls, iconName, explanation } = statusDefinition(status);
    return `<span class="row-status ${cls} g3-title" role="img" aria-label="${escapeHtml(explanation)}" title="${escapeHtml(explanation)}"><span class="status-icon" aria-hidden="true">${iconMarkup(iconName)}</span></span>`;
  }

  function updateStandaloneStatus(element, status) {
    if (!element) return;
    const { cls, iconName, explanation } = statusDefinition(status);
    element.className = `verified-mark ${cls} g3-title`;
    element.setAttribute('aria-label', explanation);
    element.setAttribute('title', explanation);
    element.innerHTML = iconMarkup(iconName);
    window.G3Tooltip?.refresh([element]);
  }

  function refreshG3Tooltips(root) {
    if (!root || !window.G3Tooltip) return;
    window.G3Tooltip.refresh(root.querySelectorAll('.g3-title[title]'));
  }

  function readableStatus(state, options = {}) {
    const status = state?.status;
    const value = state?.value;
    if (['not_present', 'not_requested'].includes(status)) return 'Not Requested';
    if (value === null || value === undefined || ['missing', 'not_found'].includes(status)) return 'Missing';
    if (['needs_review', 'uncertain'].includes(status)) return 'Needs Review';
    const confidence = state?.confidence;
    if (confidence === null || confidence === undefined || !Number.isFinite(Number(confidence)) || Number(confidence) < 0.8) return 'Needs Review';
    if (options.requireProvenance && !normalizedHighlightBox(state?.provenance?.bbox)) return 'Needs Review';
    if (status === 'reinspected') return 'Reinspected';
    return 'Verified';
  }

  function rowStatus(row) {
    const states = Object.values(row.__states?.fields || {});
    if (['failed', 'budget_exhausted'].includes(row.__states?.localization_status)) return 'Needs Review';
    if (!normalizedHighlightBox(row.source_bbox)) return 'Needs Review';
    const statuses = states.map((state) => readableStatus(state, { requireProvenance: false }));
    if (statuses.some((status) => ['Needs Review', 'Missing'].includes(status))) return 'Needs Review';
    if (statuses.some((status) => status === 'Reinspected')) return 'Reinspected';
    return 'Verified';
  }

  function displayValue(value) { return value === null || value === undefined || value === '' ? '—' : String(value); }

  function renderLineItems() {
    const rows = filteredRows();
    const resultPageCount = Math.max(1, Math.ceil(rows.length / 10));
    currentLinePage = Math.max(1, Math.min(resultPageCount, currentLinePage));
    const start = (currentLinePage - 1) * 10;
    const pageRows = rows.slice(start, start + 10);
    els.lineItemHeaders.innerHTML = `${groups.line.map((field) => `<th>${escapeHtml(fieldLabel(field))}</th>`).join('')}<th>${escapeHtml(t('result.status'))}</th>`;
    els.lineItemRows.innerHTML = pageRows.map((row) => `<tr data-row="${row.__index}" class="${selectedRow?.__index === row.__index ? 'selected' : ''}" tabindex="0">${groups.line.map((field) => `<td title="${escapeHtml(displayValue(row[field.key]))}">${escapeHtml(displayValue(row[field.key]))}</td>`).join('')}<td>${statusMarkup(rowStatus(row))}</td></tr>`).join('');
    els.mobileLineItems.innerHTML = pageRows.map((row) => `<button type="button" class="mobile-line-row ${selectedRow?.__index === row.__index ? 'selected' : ''}" data-row="${row.__index}"><span class="mobile-line-top"><b>${escapeHtml(displayValue(row.sn ?? t('viewer.row', { row: row.__index + 1 })))}${row.stock_code ? ` · ${escapeHtml(row.stock_code)}` : ''}</b>${statusMarkup(rowStatus(row))}</span><span>${escapeHtml(displayValue(row.description ?? Object.values(row).find((value) => typeof value === 'string')))}</span><span class="mobile-line-values">${groups.line.filter((field) => !['sn', 'stock_code', 'description'].includes(field.key)).slice(0, 3).map((field) => `<span>${escapeHtml(fieldLabel(field))}<strong>${escapeHtml(displayValue(row[field.key]))}</strong></span>`).join('')}</span></button>`).join('');
    els.paginationSummary.textContent = rows.length ? t('result.showingRows', { from: start + 1, to: Math.min(start + 10, rows.length), count: rows.length }) : t('result.noRows');
    els.linePage.textContent = `${currentLinePage} / ${resultPageCount}`;
    $('prevRows').disabled = currentLinePage <= 1;
    $('nextRows').disabled = currentLinePage >= resultPageCount;
    els.lineItemCount.textContent = `(${t('dynamic.rows', { count: lineItems.length })})`;
    refreshG3Tooltips(els.lineItemRows);
    refreshG3Tooltips(els.mobileLineItems);
  }

  function selectRow(index) {
    const row = lineItems.find((item) => item.__index === Number(index));
    if (!row) return;
    selectedRow = row;
    setDocumentPage(row.source_page || 1);
    els.documentHighlight.querySelector('span').textContent = row.amount ? t('viewer.rowAmount', { row: displayValue(row.sn ?? row.__index + 1), amount: row.amount }) : t('viewer.row', { row: displayValue(row.sn ?? row.__index + 1) });
    const localized = ['Verified', 'Reinspected'].includes(rowStatus(row)) && positionHighlight(row.source_bbox);
    els.documentHighlight.hidden = !localized;
    if (!localized) showToast(t('toast.notLocalized'));
    renderLineItems();
    document.querySelector('[data-view="document"]')?.click();
  }

  function resultJson() {
    return activeResult || { status: extractState === 'processing' ? 'processing' : 'not_run' };
  }

  function updateJson() {
    els.jsonOutput.textContent = JSON.stringify(resultJson(), null, 2);
  }

  function buildExtractionContract() {
    const mapFields = (fields) => fields.map((field) => ({ key: field.key, label: field.label, type: String(field.type || 'Text').toLowerCase(), required: Boolean(field.required) }));
    return { schemaVersion: 'idp_extraction_contract_v1', documentType: 'purchase_order', documentFields: mapFields(groups.document), lineItemFields: mapFields(groups.line), totalFields: mapFields(groups.total), advancedPrompt: els.advancedPrompt.value.trim() };
  }

  async function selectedOrSampleFile() {
    if (selectedDocument) return selectedDocument;
    const response = await fetch(SAMPLE_URL);
    if (!response.ok) throw new Error(t('error.sampleUnavailable'));
    return new File([await response.blob()], SAMPLE_NAME, { type: 'application/pdf' });
  }

  function enterProcessingState(message = 'Building extraction contract') {
    extractState = 'processing'; activeResult = null; activeEvaluation = null; lineItems = []; selectedRow = null; agentEvents = []; telemetrySeq = 0;
    runStartedAt = Date.now();
    els.emptyState.hidden = true; els.errorState.hidden = true; els.completedResult.hidden = true; els.processingState.hidden = false; els.compactSummary.hidden = true;
    els.runButton.disabled = true; els.emptyRunButton.disabled = true; els.exportButton.disabled = true;
    els.fileStatus.textContent = t('status.preparing'); els.fileStatus.className = 'status-pill processing'; els.fileStatus.removeAttribute('title'); els.fileStatus.removeAttribute('data-g3tooltip'); els.rowCount.textContent = t('processing.rowsPending');
    els.processingTitle.textContent = t('processing.preparing'); els.progressText.textContent = message; els.processingDetail.textContent = t('processing.unchangedRuntime'); els.progressBar.style.width = '4%'; updateJson(); renderIssuesAndTrace();
  }

  async function runExtraction() {
    if (extractState === 'processing') return;
    if (!navigator.onLine) { showToast(t('error.offline')); return; }
    try {
      if (!vault) vault = await openVault();
      providerConfig = readProviderForm();
      const apiKey = await vault.get('provider_credentials', providerConfig.provider);
      if (!apiKey?.key) { openProvider(); throw new Error(t('error.providerKey', { provider: providerConfig.provider === 'openai' ? 'OpenAI' : 'Gemini' })); }
      const contract = validateContract(buildExtractionContract());
      const file = await selectedOrSampleFile();
      const metadata = await loadDocument(file);
      activeRunId = crypto.randomUUID();
      enterProcessingState();
      const documentBuffer = await file.arrayBuffer();
      const documentHash = await hashBuffer(documentBuffer);
      try { const health = await storageHealth(); if (!health.available || health.usage + file.size > health.allowed) throw new Error(t('error.storageLimit')); await vault.set('documents', documentHash, { name: file.name, type: file.type, bytes: documentBuffer }, { createdAt: new Date().toISOString() }); } catch (error) { storageWarning = t('error.sourceSave'); showToast(storageWarning); }
      runArtifacts = [];
      runtime = new AgentRuntimeClient(renderer, handleRuntimeEvent, (artifact) => runArtifacts.push(artifact));
      const result = await runtime.run({ runId: activeRunId, fileName: file.name, documentHash, pageCount: metadata.pageCount, contract, config: providerConfig, apiKey: apiKey.key });
      runtime.stop();
      const status = { elapsed_ms: result.usage?.elapsed_ms || 0 };
      applyResult(result, status);
      try { await vault.set('runs', activeRunId, result, { createdAt: new Date().toISOString(), provider: providerConfig.provider, status: result.status }); await vault.set('artifacts', activeRunId, { inspections: runArtifacts, trace: agentEvents, corrections: result.agent?.corrections || [] }, { createdAt: new Date().toISOString() }); } catch (error) { storageWarning = t('error.localSave'); showToast(storageWarning); }
      await refreshHistory();
    } catch (error) { await showRunError(error); }
  }

  function phaseLabel(phase) { return ({ preparing: t('status.preparing'), extracting: t('status.extracting'), validating: t('status.validating'), reinspecting: t('status.reinspecting'), finalizing: t('status.finalizing'), completed: t('status.completed'), completed_with_review: t('status.needsReview'), failed: t('status.failed') })[phase] || t('status.processing'); }
  function stepLabel(step) {
    const keys = { preparing: 'status.preparing', extracting: 'status.extracting', validating: 'status.validating', reinspecting: 'status.reinspecting', finalizing: 'status.finalizing', completed: 'status.completed', failed: 'status.failed', primary_extraction: 'phase.primaryExtraction', primary_extraction_result: 'phase.primaryResult', structured_response_retry: 'phase.structuredRetry', validation: 'phase.validation', page_validation: 'phase.pageValidation', agent_decision: 'phase.agentDecision', forced_localization: 'phase.forcedLocalization', region_localization: 'phase.regionLocalization', localization_result: 'phase.localizationResult', inspect_region: 'phase.inspectRegion', targeted_reread: 'phase.targetedReread', provenance_commit: 'phase.provenanceCommit', reconciliation: 'phase.reconciliation', stop: 'phase.stop', final_validation: 'phase.finalValidation', complete: 'phase.complete', runtime: 'phase.runtime' };
    return keys[step] ? t(keys[step]) : String(step || t('phase.runtime')).replaceAll('_', ' ');
  }

  function handleRuntimeEvent(event) {
    const safe = safeTraceEvent(event);
    const suppliedSequence = Number(safe.seq);
    if (Number.isFinite(suppliedSequence) && suppliedSequence > 0) telemetrySeq = Math.max(telemetrySeq, suppliedSequence);
    else safe.seq = ++telemetrySeq;
    agentEvents.push(safe); agentEvents = agentEvents.slice(-2000);
    const phase = phaseLabel(safe.phase); els.processingTitle.textContent = phase; els.progressText.textContent = safe.step ? stepLabel(safe.step) : phase; els.fileStatus.textContent = phase; els.fileStatus.className = 'status-pill processing';
    const percent = safe.phase === 'preparing' ? 5 : safe.phase === 'extracting' ? 12 + Math.round((Number(safe.page || 0) / Math.max(1, pageCount)) * 55) : safe.phase === 'validating' ? 72 : safe.phase === 'reinspecting' ? 84 : safe.phase === 'finalizing' ? 96 : 8;
    els.progressBar.style.width = `${percent}%`; els.processingDetail.textContent = safe.message || t('processing.workerEvent', { seq: safe.seq, step: stepLabel(safe.step), page: safe.page ? ` · ${t('viewer.page', { page: safe.page, total: pageCount })}` : '' });
    renderIssuesAndTrace();
  }

  function applyResult(result, status, evaluation = activeEvaluation) {
    activeResult = result; activeEvaluation = evaluation || null; extractState = 'completed'; pageCount = Number(result.document?.page_count || pageCount); currentPage = 1; currentLinePage = 1;
    lineItems = (result.data?.line_items || []).map((row, index) => ({ ...row, __index: index, __states: result.field_states?.line_items?.[index] || {} }));
    els.processingState.hidden = true; els.errorState.hidden = true; els.emptyState.hidden = true; els.completedResult.hidden = false; els.compactSummary.hidden = false; els.runButton.disabled = !navigator.onLine; els.emptyRunButton.disabled = !navigator.onLine; els.exportButton.disabled = false;
    els.fileStatus.textContent = result.status === 'completed' ? t('status.completed') : t('status.needsReview'); els.fileStatus.className = `status-pill ${result.status === 'completed' ? 'completed' : 'review'}`; els.fileStatus.removeAttribute('title'); els.fileStatus.removeAttribute('data-g3tooltip'); els.fileName.textContent = result.document?.file_name || els.fileName.textContent; els.pageCountMeta.textContent = t('dynamic.pageCount', { count: pageCount, suffix: pageCount === 1 ? '' : 's' }); els.rowCount.textContent = t('dynamic.rows', { count: lineItems.length });
    els.elapsedSummary.textContent = t('processing.completedIn', { duration: formatDuration(result.usage?.elapsed_ms || status.elapsed_ms || 0) }); els.pagesSummary.textContent = t('processing.pages', { done: pageCount, total: pageCount });
    renderThumbnails(); setDocumentPage(1); renderDocumentFields(); renderLineItems(); renderTotals(); renderIssuesAndTrace(result); updateJson(); showToast(result.status === 'completed' ? t('toast.completed') : t('toast.completedReview'));
  }

  function safeErrorSummary(error) {
    return String(error?.message || error || 'Unknown extraction error')
      .replace(/data:[^\s,]+;base64,[A-Za-z0-9+/=]+/gi, '[image data redacted]')
      .replace(/AIza[A-Za-z0-9_-]{20,}/g, 'AIza…[redacted]')
      .replace(/(sk-[A-Za-z0-9_-]{8})[A-Za-z0-9_-]+/g, '$1…[redacted]')
      .replace(/[\r\n\t]+/g, ' ')
      .slice(0, 300);
  }

  function applyFailureState(failure) {
    const lastComplete = [...agentEvents].reverse().find((event) => event.status === 'complete');
    const failedEvent = [...agentEvents].reverse().find((event) => event.status === 'error');
    activeResult = failure; extractState = 'failed'; lineItems = [];
    els.processingState.hidden = true; els.completedResult.hidden = true; els.emptyState.hidden = true; els.errorState.hidden = false; els.compactSummary.hidden = !activeRunId;
    els.runButton.disabled = !navigator.onLine; els.emptyRunButton.disabled = !navigator.onLine; els.exportButton.disabled = false;
    els.errorMessage.textContent = failure.error?.message || t('error.generic');
    const failedAt = failedEvent ? t('dynamic.failedAt', { step: failedEvent.step || failedEvent.phase, page: failedEvent.page ? ` · ${t('dynamic.pageOnly', { page: failedEvent.page })}` : '' }) + ' ' : '';
    els.errorStep.textContent = lastComplete ? `${failedAt}${t('dynamic.lastCompleted', { step: lastComplete.step || lastComplete.phase, page: lastComplete.page ? ` · ${t('dynamic.pageOnly', { page: lastComplete.page })}` : '' })}` : `${failedAt}${t('dynamic.noStep')}`;
    els.fileStatus.textContent = t('status.failed'); els.fileStatus.className = 'status-pill review g3-title';
    els.fileStatus.setAttribute('title', failure.error?.message || t('error.title'));
    els.fileStatus.setAttribute('data-g3tooltip', failure.error?.message || t('error.title'));
    window.G3Tooltip?.refresh([els.fileStatus]);
    els.rowCount.textContent = t('processing.rowsUnavailable');
    els.elapsedSummary.textContent = t('processing.failedAfter', { duration: formatDuration(failure.usage?.elapsed_ms || 0) });
    const processed = Number(failure.agent?.pages_processed || 0);
    els.pagesSummary.textContent = processed ? t('processing.pages', { done: processed, total: pageCount }) : lastComplete?.page ? t('processing.lastPage', { page: lastComplete.page, total: pageCount }) : t('processing.pagesAvailable', { total: pageCount });
    renderIssuesAndTrace(failure); updateJson();
    document.querySelector('[data-view="result"]')?.click();
  }

  async function showRunError(error) {
    const wasProcessing = extractState === 'processing';
    runtime?.stop(); runtime = null;
    const message = safeErrorSummary(error);
    if (!agentEvents.some((event) => event.phase === 'failed' && event.status === 'error')) {
      telemetrySeq += 1;
      agentEvents.push(safeTraceEvent({ seq: telemetrySeq, at: new Date().toISOString(), runId: activeRunId, phase: 'failed', step: 'runtime', status: 'error', error_code: 'runtime_error', message }));
    }
    const failure = {
      schema_version: 'idp_agentic_extraction_failure_v1',
      run_id: activeRunId,
      status: 'failed',
      document: { file_name: selectedDocument?.name || els.fileName.textContent, page_count: pageCount },
      error: { message },
      validation: { status: 'failed', issues: [] },
      agent: { model_calls: Number(error?.failure?.model_calls || 0), reinspections: Number(error?.failure?.inspections || 0), iterations: Number(error?.failure?.iterations || 0), pages_processed: Number(error?.failure?.pages_processed || 0), localization: error?.failure?.localization || null },
      usage: { elapsed_ms: Number(error?.failure?.elapsed_ms || (runStartedAt ? Date.now() - runStartedAt : 0)) }
    };
    applyFailureState(failure);
    showToast(message);
    if (vault && activeRunId && wasProcessing) {
      try {
        const createdAt = new Date().toISOString();
        await vault.set('runs', activeRunId, failure, { createdAt, provider: providerConfig.provider, status: 'failed' });
        await vault.set('artifacts', activeRunId, { inspections: runArtifacts, trace: agentEvents, corrections: [] }, { createdAt });
        await refreshHistory();
      } catch { showToast(t('toast.memoryOnly')); }
    }
  }

  function formatDuration(ms) { const seconds = Math.max(0, Math.round(Number(ms || 0) / 1000)); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`; }

  function renderTotals() {
    const values = activeResult?.data?.totals || {};
    els.totalsList.innerHTML = groups.total.map((field) => { const state = activeResult?.field_states?.totals?.[field.key] || {}; return `<div class="source-field" data-group="totals" data-key="${escapeHtml(field.key)}" tabindex="0"><dt>${escapeHtml(fieldLabel(field))}</dt><dd>${escapeHtml(displayValue(values[field.key]))} ${statusMarkup(readableStatus(state, { requireProvenance: true }))}</dd></div>`; }).join('');
    refreshG3Tooltips(els.totalsList);
    const legacyMismatch = (activeResult?.validation?.issues || []).some((issue) => issue.code === 'total_mismatch');
    const totalsCheck = activeResult?.validation?.financial_check || { status: legacyMismatch ? 'fail' : 'not_evaluated' };
    const rowsCheck = activeResult?.validation?.line_item_check || { status: 'not_evaluated' };
    const checkLabel = (status) => status === 'pass' ? t('result.checkPass') : status === 'fail' ? t('result.checkFail') : t('result.checkNotEvaluated');
    els.financialExpression.innerHTML = `<div class="financial-check-row"><span>${escapeHtml(t('result.documentTotalsCheck'))}</span><strong class="check-${escapeHtml(totalsCheck.status)}">${escapeHtml(checkLabel(totalsCheck.status))}</strong></div><div class="financial-check-row"><span>${escapeHtml(t('result.lineArithmeticCheck'))}</span><strong class="check-${escapeHtml(rowsCheck.status)}">${escapeHtml(checkLabel(rowsCheck.status))}</strong></div>`;
    const overall = [totalsCheck.status, rowsCheck.status].includes('fail') ? 'fail' : [totalsCheck.status, rowsCheck.status].includes('not_evaluated') ? 'not_evaluated' : 'pass';
    els.financialStatus.textContent = overall === 'pass' ? t('result.arithmeticPass') : overall === 'fail' ? t('result.arithmeticFail') : t('result.arithmeticNotEvaluated');
    els.financialStatus.className = overall === 'pass' ? '' : 'review-text';
  }

  function renderIssuesAndTrace(result = activeResult) {
    const issues = result?.validation?.issues || [];
    const localization = (issue) => {
      const related = agentEvents.filter((event) => (Array.isArray(event.field_paths) && event.field_paths.includes(issue.path)) || (Array.isArray(event.target_ids) && event.target_ids.includes(issue.path)) || event.target_id === issue.path);
      if (related.some((event) => event.step === 'provenance_commit' && event.status === 'complete')) return { text: t('issues.localized'), kind: 'localized' };
      if (related.some((event) => event.step === 'inspect_region' && event.status === 'complete')) return { text: t('issues.croppedUnverified'), kind: 'unlocated' };
      if (related.some((event) => ['region_localization', 'forced_localization', 'provenance_commit'].includes(event.step) && ['error', 'warning'].includes(event.status))) return { text: t('issues.localizationFailed'), kind: 'failed' };
      return { text: t('issues.notLocalized'), kind: 'unlocated' };
    };
    els.issueList.innerHTML = issues.length ? issues.slice(0, 100).map((issue, index) => { const location = localization(issue); return `<button type="button" data-issue-index="${index}"><span><b>${escapeHtml(issue.code)}${issue.page ? ` · ${t('dynamic.pageOnly', { page: issue.page })}` : ''}${issue.row ? ` · ${t('viewer.row', { row: issue.row })}` : ''}</b><small>${escapeHtml(issue.message || issue.path || '')}</small><small class="localization-label ${location.kind}">${escapeHtml(location.text)}</small></span><em class="${issue.severity === 'high' ? 'review' : 'reinspected'}">${escapeHtml(issue.severity || 'info')}</em></button>`; }).join('') : `<p class="drawer-empty">${escapeHtml(t('dynamic.noIssues'))}</p>`;
    els.traceList.innerHTML = agentEvents.length ? agentEvents.slice().reverse().map((event) => {
      const details = [event.message, event.page ? t('dynamic.pageOnly', { page: event.page }) : '', event.target_ids?.length ? `${t('trace.targets')}: ${event.target_ids.join(', ')}` : '', event.bbox ? `bbox ${JSON.stringify(event.bbox)}` : '', traceMetricsLabel(event)].filter(Boolean).join(' · ');
      return `<li class="trace-${escapeHtml(event.status || 'info')}"><span>${escapeHtml(stepLabel(event.step || event.phase))}</span><em>${escapeHtml(event.status || 'info')}</em><small>${escapeHtml(details)}</small><time>${escapeHtml(new Date(event.at).toLocaleTimeString(locale))}</time></li>`;
    }).join('') : `<li class="drawer-empty">${escapeHtml(t('dynamic.noEvents'))}</li>`;
    if (els.downloadTrace) els.downloadTrace.disabled = agentEvents.length === 0;
    els.evaluationSummary.innerHTML = `<p class="drawer-empty">${escapeHtml(t('dynamic.runSummary', { run: activeRunId || 'not started', provider: providerConfig.provider, model: providerConfig.model }))}</p>`;
    const coverage = result?.agent?.localization;
    els.issuesButton.textContent = coverage ? t('dynamic.coverage', { located: coverage.located_targets, unlocated: coverage.unlocated_targets, failed: coverage.localization_failed + coverage.localization_budget_exhausted }) : t('issues.trace', { count: issues.length });
  }

  function selectDocument() {
    if (extractState !== 'processing') els.documentInput.click();
  }

  function acceptSelectedDocument() {
    const file = els.documentInput.files?.[0];
    if (!file) return;
    const extension = file.name.split('.').pop().toLowerCase(), supported = ['pdf', 'png', 'jpg', 'jpeg'].includes(extension);
    if (!supported || file.size > 20 * 1024 * 1024) { els.documentInput.value = ''; showToast(t('error.fileType')); return; }
    selectedDocument = file; activeRunId = ''; activeResult = null; activeEvaluation = null; pageCount = 1; currentPage = 1;
    els.fileName.textContent = file.name; els.fileStatus.textContent = t('status.ready'); els.fileStatus.className = 'status-pill'; els.fileStatus.removeAttribute('title'); els.fileStatus.removeAttribute('data-g3tooltip'); els.pageCountMeta.textContent = extension === 'pdf' ? t('processing.pagesPending') : t('dynamic.pageCount', { count: 1, suffix: '' }); els.rowCount.textContent = t('processing.rowsPending');
    els.completedResult.hidden = true; els.processingState.hidden = true; els.errorState.hidden = true; els.emptyState.hidden = false; els.compactSummary.hidden = true; extractState = 'idle';
    loadDocument(file).then(() => showToast(t('toast.selected', { file: file.name }))).catch(showRunError); updateJson();
  }

  function showAggregateProvenance(group, key, label) {
    const state = activeResult?.field_states?.[group]?.[key];
    if (!['Verified', 'Reinspected'].includes(readableStatus(state, { requireProvenance: true }))) { showToast(t('error.noRegion')); return; }
    const candidates = Array.isArray(state?.provenance) ? state.provenance : state?.provenance ? [state.provenance] : [];
    const provenance = candidates.find((row) => row?.page && normalizedHighlightBox(row?.bbox));
    if (!provenance) { showToast(t('error.noRegion')); return; }
    selectedRow = { __index: -1, source_page: Number(provenance.page), source_bbox: provenance.bbox };
    setDocumentPage(provenance.page); els.documentHighlight.querySelector('span').textContent = label; els.documentHighlight.hidden = false; positionHighlight(provenance.bbox); document.querySelector('[data-view="document"]')?.click();
  }

  function focusIssue(index) {
    const issue = activeResult?.validation?.issues?.[Number(index)]; if (!issue) return;
    if (issue.page && issue.row) {
      const row = lineItems.filter((item) => Number(item.source_page) === Number(issue.page))[Number(issue.row) - 1];
      if (row) { closeIssues(); selectRow(row.__index); return; }
    }
    showToast(issue.page ? t('dynamic.issueRow', { page: issue.page }) : t('dynamic.documentIssueNoBbox'));
  }

  function switchResultTab(tab) {
    const json = tab === 'json';
    els.dataTab.setAttribute('aria-selected', String(!json));
    els.jsonTab.setAttribute('aria-selected', String(json));
    els.dataPanel.hidden = json;
    els.jsonPanel.hidden = !json;
    if (json) updateJson();
  }

  function download(filename, content, type) {
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(new Blob([content], { type }));
    anchor.download = filename;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(anchor.href), 0);
  }

  async function hashBuffer(buffer) {
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buffer))).map((value) => value.toString(16).padStart(2, '0')).join('');
  }

  async function loadDocument(file) {
    thumbnailQueue.cancel();
    pagePreviewUrls.clear();
    pagePreviewPromises.clear();
    pageRequestSequence += 1;
    const metadata = await renderer.load(file);
    pageCount = metadata.pageCount; currentPage = 1;
    els.fileName.textContent = file.name; els.pageCountMeta.textContent = t('dynamic.pageCount', { count: pageCount, suffix: pageCount === 1 ? '' : 's' });
    renderThumbnailShell();
    documentGeneration = thumbnailQueue.reset(pageCount);
    await setDocumentPage(1);
    return metadata;
  }

  function readProviderForm() {
    return sanitizeProviderConfig({ provider: $('providerSelect').value, model: $('providerModel').value, reasoning: $('providerReasoning').value });
  }

  function providerDefaults(provider) {
    return provider === 'openai' ? { provider: 'openai', model: 'gpt-5-mini', reasoning: 'medium' } : { provider: 'gemini', model: 'gemini-3.5-flash-lite', reasoning: 'medium' };
  }

  async function updateCredentialStatus() {
    if (!vault) return;
    const config = readProviderForm();
    const saved = await vault.get('provider_credentials', config.provider).catch(() => null);
    $('credentialStatus').dataset.runtimeText = 'true'; $('credentialStatus').textContent = saved?.key ? t('provider.saved', { provider: config.provider === 'openai' ? 'OpenAI' : 'Gemini' }) : t('provider.noKey');
    $('deleteProvider').disabled = !saved?.key;
    providerConfig = config; $('providerMeta').textContent = `${config.provider === 'openai' ? 'OpenAI' : 'Gemini'} · ${config.model}`;
  }

  async function saveProvider() {
    const config = readProviderForm(), key = $('providerKey').value.trim();
    if (!key) throw new Error(t('error.saveKey'));
    await vault.set('provider_credentials', config.provider, { key, savedAt: new Date().toISOString() }, { provider: config.provider, createdAt: new Date().toISOString() });
    $('providerKey').value = ''; providerConfig = config; localStorage.setItem('idp-lab-provider', JSON.stringify(config)); await updateCredentialStatus(); showToast(t('toast.savedKey'));
  }

  async function deleteProviderKey() {
    const config = readProviderForm(); await vault.remove('provider_credentials', config.provider); $('providerKey').value = ''; await updateCredentialStatus(); showToast(t('toast.deletedKey'));
  }

  async function testProviderConnection() {
    if (!navigator.onLine) throw new Error(t('error.providerTestOffline'));
    const config = readProviderForm(), saved = await vault.get('provider_credentials', config.provider); if (!saved?.key) throw new Error(t('error.noSavedKey'));
    if (!window.confirm(t('provider.connectionCost'))) return;
    $('testProvider').disabled = true;
    try { runtime = new AgentRuntimeClient(renderer); const result = await runtime.testProvider({ config, apiKey: saved.key }); showToast(t('toast.connection', { ms: result.latencyMs || 0 })); } finally { runtime?.stop(); $('testProvider').disabled = false; }
  }

  function openProvider() { previousFocus = document.activeElement; $('providerDrawer').hidden = false; document.body.style.overflow = 'hidden'; document.querySelector('#providerDrawer .provider-modal').focus(); updateCredentialStatus(); refreshHistory(); }
  function closeProvider() { $('providerDrawer').hidden = true; document.body.style.overflow = ''; previousFocus?.focus(); }

  async function refreshHistory() {
    if (!vault) return;
    const runs = await vault.list('runs');
    $('runHistory').innerHTML = runs.length ? runs.map((run) => `<div class="history-row"><button type="button" data-open-run="${escapeHtml(run.id)}"><strong>${escapeHtml(run.provider || 'provider')} · ${escapeHtml(run.status || 'saved')}</strong><small>${escapeHtml(new Date(run.createdAt || run.updatedAt).toLocaleString(locale))}</small></button><button class="mini-action" type="button" data-delete-run="${escapeHtml(run.id)}" aria-label="${escapeHtml(t('accessibility.deleteRun'))}">${iconMarkup('trash')}</button></div>`).join('') : `<p class="drawer-empty">${escapeHtml(t('dynamic.historyEmpty'))}</p>`;
  }

  async function openSavedRun(runId) {
    const result = await vault.get('runs', runId); if (!result) return;
    activeRunId = runId;
    const artifacts = await vault.get('artifacts', runId).catch(() => null);
    agentEvents = Array.isArray(artifacts?.trace) ? artifacts.trace.map(safeTraceEvent) : [];
    telemetrySeq = agentEvents.reduce((maximum, event) => Math.max(maximum, Number(event.seq || 0)), 0);
    closeProvider();
    if (result.status === 'failed') applyFailureState(result);
    else applyResult(result, { elapsed_ms: result.usage?.elapsed_ms || 0 });
  }

  async function clearLocalData() {
    if (!window.confirm(t('dynamic.deleteDataConfirm'))) return;
    await vault.clearAll(); await updateCredentialStatus(); await refreshHistory(); showToast(t('toast.clearedData'));
  }

  async function updateStorageStatus() {
    const health = await storageHealth().catch(() => null);
    const storageText = health ? `${health.persisted ? t('storage.persistent') : t('storage.bestEffort')} · ${t('storage.used', { mb: Math.round(health.usage / 1024 / 1024) })} · ${t('storage.cap', { mb: Math.round(health.allowed / 1024 / 1024) })}` : t('storage.unavailable');
    $('storageStatus').dataset.runtimeText = 'true'; $('storageStatus').textContent = storageText;
  }

  function openIssues() {
    previousFocus = document.activeElement;
    els.issuesDrawer.hidden = false;
    document.body.style.overflow = 'hidden';
    els.issuesPanel.focus();
  }

  function closeIssues() {
    els.issuesDrawer.hidden = true;
    document.body.style.overflow = '';
    previousFocus?.focus();
  }

  function ensureValidActiveView() {
    const nextView = activePaneAfterHide(layoutState, els.workspace.dataset.activeView || 'fields');
    els.workspace.dataset.activeView = nextView;
    document.querySelectorAll('.workspace-tabs button').forEach((button) => {
      const active = button.dataset.view === nextView && !layoutState.hidden[button.dataset.view];
      button.classList.toggle('active', active);
      button.toggleAttribute('aria-current', active);
      button.hidden = Boolean(layoutState.hidden[button.dataset.view]);
    });
  }

  function updateLayoutMenu() {
    if (!els.layoutMenu) return;
    const visibleCount = visiblePaneKeys(layoutState).length;
    layoutMenuSyncing = true;
    try {
      els.layoutMenu.querySelectorAll('[data-layout-pane]').forEach((input) => {
        const key = input.dataset.layoutPane;
        input.checked = !layoutState.hidden[key];
        input.disabled = visibleCount === 1 && input.checked;
      });
    } finally {
      layoutMenuSyncing = false;
    }
  }

  function configureResizers() {
    const first = document.querySelector('[data-resizer="primary"]');
    const second = document.querySelector('[data-resizer="secondary"]');
    if (!first || !second) return;
    [first, second].forEach((resizer) => { resizer.hidden = true; resizer.removeAttribute('data-left'); resizer.removeAttribute('data-right'); });
    const visible = visiblePaneKeys(layoutState);
    const show = (resizer, left, right) => {
      resizer.dataset.left = left;
      resizer.dataset.right = right;
      resizer.hidden = false;
      resizer.setAttribute('aria-valuemin', '10');
      resizer.setAttribute('aria-valuemax', '90');
      resizer.setAttribute('aria-valuenow', String(boundaryValue(layoutState, left)));
    };
    if (visible.length === 3) { show(first, 'fields', 'document'); show(second, 'document', 'result'); }
    else if (visible.length === 2) {
      const pair = visible.join('|');
      if (pair === 'document|result') show(second, 'document', 'result');
      else show(first, visible[0], visible[1]);
    }
  }

  function applyLayoutState({ persist = true } = {}) {
    if (persist) layoutState = saveLayoutState(layoutState);
    const visible = visiblePaneKeys(layoutState);
    const panes = { fields: document.querySelector('.fields-pane'), document: document.querySelector('.document-pane'), result: document.querySelector('.result-pane') };
    PANE_KEYS.forEach((key) => { if (panes[key]) panes[key].hidden = Boolean(layoutState.hidden[key]); });
    ensureValidActiveView();
    configureResizers();
    const visibleWidthTotal = visible.reduce((sum, key) => sum + layoutState.widths[key], 0);
    const columns = [];
    [...els.workspace.children].forEach((child) => {
      if (child.hidden) return;
      if (child.classList.contains('pane-resizer')) columns.push('10px');
      else if (child.dataset.pane) columns.push(`minmax(0, ${(layoutState.widths[child.dataset.pane] / visibleWidthTotal * 100).toFixed(4)}fr)`);
    });
    els.workspace.style.gridTemplateColumns = columns.join(' ');
    PANE_KEYS.forEach((key) => els.workspace.style.setProperty(`--${key}-width`, `${layoutState.widths[key]}%`));
    updateLayoutMenu();
  }

  function startPaneResize(event) {
    const resizer = event.currentTarget;
    if (window.matchMedia('(max-width: 1199px)').matches || resizer.hidden) return;
    event.preventDefault();
    paneResizeState = { resizer, startX: event.clientX, left: resizer.dataset.left, right: resizer.dataset.right, initial: layoutState };
    resizer.classList.add('dragging');
    resizer.setPointerCapture?.(event.pointerId);
  }

  function updatePaneResize(event) {
    if (!paneResizeState) return;
    const { resizer, startX, left, right } = paneResizeState;
    layoutState = resizeBoundary(layoutState, left, right, event.clientX - startX, els.workspace.clientWidth, MIN_PANE_PX);
    applyLayoutState({ persist: false });
    resizer.classList.add('dragging');
  }

  function finishPaneResize() {
    if (!paneResizeState) return;
    paneResizeState.resizer.classList.remove('dragging');
    layoutState = saveLayoutState(layoutState);
    paneResizeState = null;
  }

  function resizeFromKeyboard(event) {
    const resizer = event.currentTarget;
    if (resizer.hidden || window.matchMedia('(max-width: 1199px)').matches) return;
    const { left, right } = resizer.dataset;
    let delta = event.shiftKey ? 64 : 16;
    if (event.key === 'ArrowLeft') delta *= -1;
    else if (event.key === 'ArrowRight') { /* positive */ }
    else if (event.key === 'Home') delta = -els.workspace.clientWidth;
    else if (event.key === 'End') delta = els.workspace.clientWidth;
    else return;
    event.preventDefault();
    layoutState = resizeBoundary(layoutState, left, right, delta, els.workspace.clientWidth, MIN_PANE_PX);
    applyLayoutState();
    resizer.focus();
  }

  function onLayoutToggle(input) {
    if (layoutMenuSyncing) return;
    const result = togglePane(layoutState, input.dataset.layoutPane, input.checked);
    if (!result.changed) {
      updateLayoutMenu();
      showToast(t('toast.lastPane'));
      return;
    }
    layoutState = result.state;
    applyLayoutState();
  }

  function installLayoutListeners(resizers) {
    resizers.forEach((resizer) => {
      resizer.addEventListener('pointerdown', startPaneResize);
      resizer.addEventListener('pointermove', updatePaneResize);
      resizer.addEventListener('pointerup', finishPaneResize);
      resizer.addEventListener('pointercancel', finishPaneResize);
      resizer.addEventListener('lostpointercapture', finishPaneResize);
      resizer.addEventListener('keydown', resizeFromKeyboard);
    });
    els.layoutButton.addEventListener('click', () => {
      const open = !els.layoutMenu.hidden;
      els.layoutMenu.hidden = open;
      els.layoutButton.setAttribute('aria-expanded', String(!open));
      if (!open) els.layoutMenu.querySelector('[data-layout-pane]')?.focus();
    });
    els.closeLayoutMenu.addEventListener('click', () => { els.layoutMenu.hidden = true; els.layoutButton.setAttribute('aria-expanded', 'false'); els.layoutButton.focus(); });
    els.resetLayoutButton.addEventListener('click', () => { layoutState = cloneDefaultLayout(); applyLayoutState(); showToast(t('toast.defaultLayout')); });
    els.layoutMenu.querySelectorAll('[data-layout-pane]').forEach((input) => input.addEventListener('change', () => onLayoutToggle(input)));
    document.addEventListener('pointerdown', (event) => {
      if (!els.layoutMenu.hidden && !event.target.closest('.layout-control')) {
        els.layoutMenu.hidden = true;
        els.layoutButton.setAttribute('aria-expanded', 'false');
      }
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !els.layoutMenu.hidden) {
        els.layoutMenu.hidden = true;
        els.layoutButton.setAttribute('aria-expanded', 'false');
        els.layoutButton.focus();
      }
    });
    window.addEventListener('resize', () => applyLayoutState({ persist: false }));
  }

  function installListeners() {
    els.fieldGroups.addEventListener('click', (event) => {
      const add = event.target.closest('[data-add-group]');
      if (add) { openFieldDialog(add.dataset.addGroup); return; }
      const sectionToggle = event.target.closest('.section-toggle');
      if (sectionToggle) {
        const body = sectionToggle.nextElementSibling;
        const expanded = sectionToggle.getAttribute('aria-expanded') === 'true';
        sectionToggle.setAttribute('aria-expanded', String(!expanded));
        body.hidden = expanded;
        const toggleIcon = sectionToggle.querySelector('.section-toggle-icon');
        if (toggleIcon) toggleIcon.innerHTML = iconMarkup(expanded ? 'chevronDown' : 'chevronUp');
        return;
      }
      const row = event.target.closest('.field-row');
      if (!row) return;
      const group = row.dataset.group;
      const index = Number(row.dataset.index);
      if (event.target.closest('.remove-field')) groups[group].splice(index, 1);
      else if (event.target.closest('.move-field')) {
        const direction = Number(event.target.closest('.move-field').dataset.direction);
        const to = Math.max(0, Math.min(groups[group].length - 1, index + direction));
        const [field] = groups[group].splice(index, 1);
        groups[group].splice(to, 0, field);
      } else return;
      renderFieldGroups();
    });

    let dragState = null;
    els.fieldGroups.addEventListener('dragstart', (event) => {
      const row = event.target.closest('.field-row');
      if (!row) return;
      dragState = { group: row.dataset.group, index: Number(row.dataset.index) };
      event.dataTransfer.effectAllowed = 'move';
    });
    els.fieldGroups.addEventListener('dragover', (event) => { if (event.target.closest('.field-row')) event.preventDefault(); });
    els.fieldGroups.addEventListener('drop', (event) => {
      const row = event.target.closest('.field-row');
      if (!row || !dragState || row.dataset.group !== dragState.group) return;
      event.preventDefault();
      const to = Number(row.dataset.index);
      const [field] = groups[dragState.group].splice(dragState.index, 1);
      groups[dragState.group].splice(to, 0, field);
      dragState = null;
      renderFieldGroups();
    });

    els.advancedToggle.addEventListener('click', () => {
      const expanded = els.advancedToggle.getAttribute('aria-expanded') === 'true';
      els.advancedToggle.setAttribute('aria-expanded', String(!expanded));
      els.advancedBody.hidden = expanded;
      const toggleIcon = els.advancedToggle.querySelector('.advanced-toggle-icon');
      if (toggleIcon) toggleIcon.innerHTML = iconMarkup(expanded ? 'chevronDown' : 'chevronUp');
    });
    els.advancedPrompt.addEventListener('input', () => { els.promptCount.textContent = `${els.advancedPrompt.value.length} / 1000`; });

    document.querySelectorAll('.workspace-tabs button').forEach((button) => button.addEventListener('click', () => {
      document.querySelectorAll('.workspace-tabs button').forEach((item) => { item.classList.remove('active'); item.removeAttribute('aria-current'); });
      button.classList.add('active');
      button.setAttribute('aria-current', 'page');
      els.workspace.dataset.activeView = button.dataset.view;
    }));

    els.runButton.addEventListener('click', runExtraction);
    els.emptyRunButton.addEventListener('click', runExtraction);
    els.retryRunButton.addEventListener('click', runExtraction);
    els.viewFailureTrace.addEventListener('click', openIssues);
    els.selectDocumentButton.addEventListener('click', selectDocument);
    els.documentInput.addEventListener('change', acceptSelectedDocument);
    els.exportButton.addEventListener('click', () => download(`idp-extraction-${activeRunId || 'result'}.json`, JSON.stringify(resultJson(), null, 2), 'application/json'));
    els.dataTab.addEventListener('click', () => switchResultTab('data'));
    els.jsonTab.addEventListener('click', () => switchResultTab('json'));
    $('copyJson').addEventListener('click', async () => { await navigator.clipboard.writeText(els.jsonOutput.textContent); showToast(t('toast.copied')); });
    $('downloadJson').addEventListener('click', () => download('idp-extraction.json', els.jsonOutput.textContent, 'application/json'));

    $('previousPage').addEventListener('click', () => setDocumentPage(currentPage - 1));
    $('nextPage').addEventListener('click', () => setDocumentPage(currentPage + 1));
    $('zoomOut').addEventListener('click', () => setZoom(zoom - 25));
    $('zoomIn').addEventListener('click', () => setZoom(zoom + 25));
    $('fitButton').addEventListener('click', () => { zoom = 100; $('zoomLabel').textContent = 'Fit'; els.pageFrame.classList.add('fit'); els.pageFrame.style.setProperty('--page-scale', '1'); });
    $('fullscreenButton').addEventListener('click', () => els.viewerBody.requestFullscreen?.());
    els.thumbnailRail.addEventListener('click', (event) => { const button = event.target.closest('[data-page]'); if (button) setDocumentPage(button.dataset.page); });

    els.rowSearch.addEventListener('input', () => { currentLinePage = 1; renderLineItems(); });
    $('prevRows').addEventListener('click', () => { currentLinePage -= 1; renderLineItems(); });
    $('nextRows').addEventListener('click', () => { currentLinePage += 1; renderLineItems(); });
    const selectHandler = (event) => { const target = event.target.closest('[data-row]'); if (target) selectRow(target.dataset.row); };
    els.lineItemRows.addEventListener('click', selectHandler);
    els.mobileLineItems.addEventListener('click', selectHandler);
    els.lineItemRows.addEventListener('keydown', (event) => { if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('[data-row]')) { event.preventDefault(); selectRow(event.target.dataset.row); } });
    const aggregateSourceHandler = (event) => { const target = event.target.closest('.source-field'); if (!target) return; const field = groups[target.dataset.group === 'document_fields' ? 'document' : 'total'].find((item) => item.key === target.dataset.key); showAggregateProvenance(target.dataset.group, target.dataset.key, field?.label || target.dataset.key); };
    els.documentFields.addEventListener('click', aggregateSourceHandler); els.totalsList.addEventListener('click', aggregateSourceHandler);
    els.documentFields.addEventListener('keydown', (event) => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); aggregateSourceHandler(event); } }); els.totalsList.addEventListener('keydown', (event) => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); aggregateSourceHandler(event); } });

    $('closeDialog').addEventListener('click', closeFieldDialog);
    els.fieldDialog.addEventListener('mousedown', (event) => { if (event.target === els.fieldDialog) closeFieldDialog(); });
    els.dialog.addEventListener('keydown', (event) => trapDialog(event, els.dialog, closeFieldDialog));
    els.fieldSearch.addEventListener('input', renderSuggestions);
    els.suggestedFields.addEventListener('click', (event) => { const button = event.target.closest('[data-key]'); if (button) addSuggested(button.dataset.key); });
    $('createCustomButton').addEventListener('click', openCustomMode);
    $('backToSuggested').addEventListener('click', () => { dialogMode = 'suggested'; els.customMode.hidden = true; els.suggestedMode.hidden = false; els.dialogTitle.textContent = t('contract.addDialogTitle', { group: groupLabel(activeGroup) }); renderSuggestions(); els.fieldSearch.focus(); });
    els.customLabel.addEventListener('input', () => { if (!labelTouched) els.customKey.value = normalizeKey(els.customLabel.value); });
    els.customKey.addEventListener('input', () => { labelTouched = true; els.customKey.value = els.customKey.value.toLowerCase(); });
    els.customMode.addEventListener('submit', addCustomField);

    $('issuesButton').addEventListener('click', openIssues);
    $('closeIssues').addEventListener('click', closeIssues);
    els.downloadTrace.addEventListener('click', () => download(`idp-trace-${activeRunId || 'not-started'}.ndjson`, safeTraceNdjson(agentEvents), 'application/x-ndjson'));
    els.issuesDrawer.addEventListener('mousedown', (event) => { if (event.target === els.issuesDrawer) closeIssues(); });
    els.issuesPanel.addEventListener('keydown', (event) => trapDialog(event, els.issuesPanel, closeIssues));
    els.issueList.addEventListener('click', (event) => { const button = event.target.closest('[data-issue-index]'); if (button) focusIssue(button.dataset.issueIndex); });

    $('providerButton').addEventListener('click', openProvider);
    $('closeProvider').addEventListener('click', closeProvider);
    $('providerDrawer').addEventListener('mousedown', (event) => { if (event.target === $('providerDrawer')) closeProvider(); });
    document.querySelector('#providerDrawer .provider-modal').addEventListener('keydown', (event) => trapDialog(event, document.querySelector('#providerDrawer .provider-modal'), closeProvider));
    $('providerSelect').addEventListener('change', () => { const defaults = providerDefaults($('providerSelect').value); $('providerModel').value = defaults.model; $('providerReasoning').value = defaults.reasoning; updateCredentialStatus(); });
    $('providerModel').addEventListener('change', updateCredentialStatus);
    $('providerReasoning').addEventListener('change', updateCredentialStatus);
    $('saveProvider').addEventListener('click', () => saveProvider().catch((error) => showToast(error.message)));
    $('deleteProvider').addEventListener('click', () => deleteProviderKey().catch((error) => showToast(error.message)));
    $('testProvider').addEventListener('click', () => testProviderConnection().catch((error) => showToast(error.message)));
    $('refreshHistory').addEventListener('click', refreshHistory);
    $('clearLocalData').addEventListener('click', () => clearLocalData().catch((error) => showToast(error.message)));
    $('runHistory').addEventListener('click', (event) => { const open = event.target.closest('[data-open-run]'), remove = event.target.closest('[data-delete-run]'); if (open) openSavedRun(open.dataset.openRun).catch((error) => showToast(error.message)); if (remove) vault.remove('runs', remove.dataset.deleteRun).then(refreshHistory); });

    els.pwaUpdateButton?.addEventListener('click', beginPwaUpdate);

    window.addEventListener('online', updateNetworkState);
    window.addEventListener('offline', updateNetworkState);
  }

  function updateNetworkState() {
    const offline = !navigator.onLine;
    els.offlineBanner.hidden = !offline;
    els.runButton.disabled = offline || extractState === 'processing';
    els.emptyRunButton.disabled = offline || extractState === 'processing';
    document.documentElement.dataset.networkState = offline ? 'OFFLINE' : 'ONLINE';
    if (offline && pwaUpdateState === 'READY') pwaUpdateState = 'OFFLINE';
    if (!offline && pwaUpdateState === 'OFFLINE') pwaUpdateState = 'READY';
  }

  function setPwaUpdateState(next, messageKey = 'pwa.updateAvailable') {
    pwaUpdateState = next;
    if (els.pwaUpdateBanner) {
      els.pwaUpdateBanner.dataset.state = next;
      const showBanner = next === 'UPDATE_AVAILABLE' || next === 'UPDATE_FAILED';
      els.pwaUpdateBanner.hidden = !showBanner;
      if (els.pwaUpdateMessage) {
        els.pwaUpdateMessage.dataset.i18n = messageKey;
        els.pwaUpdateMessage.textContent = t(messageKey);
      }
      if (els.pwaUpdateButton) {
        const buttonKey = next === 'UPDATE_FAILED' ? 'pwa.retryUpdate' : 'pwa.updateNow';
        const label = els.pwaUpdateButton.querySelector('[data-i18n]');
        if (label) { label.dataset.i18n = buttonKey; label.textContent = t(buttonKey); }
        els.pwaUpdateButton.disabled = next === 'UPDATING';
      }
    }
    if (els.pwaUpdateOverlay) els.pwaUpdateOverlay.hidden = next !== 'UPDATING';
  }

  function showPwaUpdateAvailable() {
    if (pwaUpdateState === 'UPDATING') return;
    setPwaUpdateState('UPDATE_AVAILABLE', 'pwa.updateAvailable');
  }

  function handlePwaUpdateFailure() {
    if (pwaUpdateRetryTimer) { clearTimeout(pwaUpdateRetryTimer); pwaUpdateRetryTimer = null; }
    pwaUpdateReloading = false;
    setPwaUpdateState('UPDATE_FAILED', 'pwa.updateFailed');
  }

  function handlePwaNeedReload() {
    if (!pwaUpdateReloading) return;
    if (pwaUpdateRetryTimer) { clearTimeout(pwaUpdateRetryTimer); pwaUpdateRetryTimer = null; }
    if (pwaControllerChangeHandler && navigator.serviceWorker) {
      navigator.serviceWorker.removeEventListener('controllerchange', pwaControllerChangeHandler);
      pwaControllerChangeHandler = null;
    }
    // Workbox has reported that the waiting worker is now controlling the
    // page.  Reload only at this point so the user never sees mixed assets.
    // Give the overlay one paint so keyboard and screen-reader users receive
    // feedback before the controlled navigation replaces the document.
    window.setTimeout(() => window.location.reload(), 160);
  }

  function waitForPwaControllerChange() {
    if (!navigator.serviceWorker) return;
    pwaControllerChangeHandler = () => handlePwaNeedReload();
    navigator.serviceWorker.addEventListener('controllerchange', pwaControllerChangeHandler, { once: true });
  }

  async function beginPwaUpdate() {
    if (pwaUpdateState === 'UPDATING') return;
    if (!navigator.onLine || typeof updateSW !== 'function') {
      handlePwaUpdateFailure();
      return;
    }
    pwaUpdateReloading = true;
    setPwaUpdateState('UPDATING', 'pwa.updating');
    waitForPwaControllerChange();
    pwaUpdateRetryTimer = setTimeout(handlePwaUpdateFailure, 15000);
    try {
      // With registerType=prompt this only activates the waiting worker. The
      // onNeedReload callback above performs the single, controlled reload.
      await updateSW(true);
    } catch (_error) {
      handlePwaUpdateFailure();
    }
  }

  async function checkForPwaUpdate(force = false) {
    if (!updateRegistration || !navigator.onLine) return;
    const now = Date.now();
    if (!force && now - pwaUpdateCheckAt < 5 * 60 * 1000) return;
    pwaUpdateCheckAt = now;
    try { await updateRegistration.update(); } catch (_error) {
      // A background check must not interrupt an active run. Only a failed
      // user-confirmed activation is surfaced in the update banner.
    }
  }

  function initializePwa() {
    updateSW = registerSW({
      immediate: true,
      onOfflineReady: () => showToast(t('toast.offlineReady')),
      onNeedRefresh: showPwaUpdateAvailable,
      onNeedReload: handlePwaNeedReload,
      onRegisteredSW: (_scriptUrl, registration) => {
        updateRegistration = registration || null;
        checkForPwaUpdate(true);
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkForPwaUpdate(); });
        window.setInterval(() => checkForPwaUpdate(), 60 * 60 * 1000);
      },
      onRegisterError: () => { if (pwaUpdateState === 'UPDATING') handlePwaUpdateFailure(); }
    });
  }

  async function initialize() {
    installLanguageDom(); renderFieldGroups(); renderDocumentFields(); renderLineItems(); updateJson(); updateNetworkState(); installLayoutDom(); installListeners(); initializePwa();
    const savedConfig = JSON.parse(localStorage.getItem('idp-lab-provider') || 'null') || providerDefaults('gemini');
    providerConfig = sanitizeProviderConfig(savedConfig); $('providerSelect').value = providerConfig.provider; $('providerModel').value = providerConfig.model; $('providerReasoning').value = providerConfig.reasoning;
    vault = await openVault(); await updateCredentialStatus(); await updateStorageStatus(); await refreshHistory();
    try { const file = await selectedOrSampleFile(); await loadDocument(file); } catch (error) { showRunError(error); }
  }
  initialize().catch((error) => showRunError(error));
})();
