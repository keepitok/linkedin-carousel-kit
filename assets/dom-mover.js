/*!
 * dom-mover — a drop-in "design change recorder".
 *
 * Drop onto any page with a single <script src="dom-mover.js"></script>.
 * Adds two floating buttons (Inspect / Copy). In inspect mode you hover to
 * highlight any element (with a short human-readable path), click to select it,
 * then drag it anywhere. The library records what moved where and exports a
 * plain-text summary to paste into an AI coding agent.
 *
 * Zero dependencies. Native Pointer Events. All tool UI lives in a Shadow DOM.
 */
(function () {
  'use strict';

  if (window.__domMoverLoaded) return;
  window.__domMoverLoaded = true;

  var HOST_ID = 'dom-mover-root';
  var Z = 2147483000;

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  var selecting = false;
  // Map<Element, changeRecord>. One entry per changed element (move and/or style).
  var moves = new Map();
  // Elements that have been selected (and are therefore draggable/formattable).
  var selected = new Set();
  var dragging = false;
  // The element the formatting panel currently acts on.
  var activeEl = null;
  var editingEl = null;      // element currently in inline text-edit mode
  var dupNodes = [];         // clones inserted by Duplicate (removed on reset)

  var host, shadow, ui, highlightBox, labelEl, copyBtn, selectBtn, countBadge, toast;
  var selBox, formatPanel, fmtTitle, boldBtn, alignBtns = {};

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------
  function boot() {
    buildUI();
    // Global listeners for select mode. Capture phase so we win over the page.
    document.addEventListener('mousemove', onHoverMove, true);
    document.addEventListener('pointerdown', onSelectPointerDown, true);
    document.addEventListener('click', onSwallowClick, true);
    document.addEventListener('dblclick', onDblClick, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition, true);
  }

  // ---------------------------------------------------------------------------
  // UI (inside Shadow DOM so page CSS can't touch it, and it's easy to exclude)
  // ---------------------------------------------------------------------------
  function buildUI() {
    host = document.createElement('div');
    host.id = HOST_ID;
    host.style.cssText = 'all: initial; position: fixed; inset: 0; pointer-events: none; z-index: ' + Z + ';';
    (document.body || document.documentElement).appendChild(host);
    shadow = host.attachShadow({ mode: 'open' });

    var style = document.createElement('style');
    style.textContent = css();
    shadow.appendChild(style);

    // Highlight overlay + label
    highlightBox = el('div', 'dm-highlight');
    labelEl = el('div', 'dm-label');
    shadow.appendChild(highlightBox);
    shadow.appendChild(labelEl);

    // Control group (right edge)
    ui = el('div', 'dm-controls');

    selectBtn = el('button', 'dm-btn dm-select');
    selectBtn.type = 'button';
    selectBtn.innerHTML = icon('cursor') + '<span>Select</span>';
    selectBtn.addEventListener('click', function () { setSelecting(!selecting); });

    var copyWrap = el('div', 'dm-copywrap');
    copyBtn = el('button', 'dm-btn dm-copy');
    copyBtn.type = 'button';
    copyBtn.innerHTML = icon('copy') + '<span>Copy</span>';
    copyBtn.addEventListener('click', copySummary);
    countBadge = el('span', 'dm-badge');
    countBadge.textContent = '0';
    copyBtn.appendChild(countBadge);

    var clearLink = el('button', 'dm-clear');
    clearLink.type = 'button';
    clearLink.textContent = 'clear';
    clearLink.addEventListener('click', resetAll);

    copyWrap.appendChild(copyBtn);
    copyWrap.appendChild(clearLink);

    // Formatting panel — shown only while an element is active.
    formatPanel = buildFormatPanel();

    ui.appendChild(selectBtn);
    ui.appendChild(copyWrap);
    ui.appendChild(formatPanel);
    shadow.appendChild(ui);

    // Persistent selection outline + resize handles for the active element.
    selBox = el('div', 'dm-selbox');
    ['e', 's', 'se'].forEach(function (dir) {
      var h = el('div', 'dm-handle dm-handle-' + dir);
      h.dataset.dir = dir;
      h.addEventListener('pointerdown', function (ev) { startResize(ev, dir); });
      selBox.appendChild(h);
    });
    shadow.appendChild(selBox);

    toast = el('div', 'dm-toast');
    shadow.appendChild(toast);

    updateBadge();
  }

  function buildFormatPanel() {
    var panel = el('div', 'dm-format');
    fmtTitle = el('div', 'dm-fmt-title');
    fmtTitle.textContent = 'No element';

    var row1 = el('div', 'dm-fmt-row');
    boldBtn = fmtButton('B', 'Bold', function () { toggleBold(); });
    boldBtn.style.fontWeight = '800';
    var minus = fmtButton('A−', 'Font size −1', function () { bumpFont(-1); });
    var plus = fmtButton('A+', 'Font size +1', function () { bumpFont(1); });
    row1.appendChild(boldBtn);
    row1.appendChild(minus);
    row1.appendChild(plus);

    var row2 = el('div', 'dm-fmt-row');
    [['left', '⤙'], ['center', '≡'], ['right', '⤚']].forEach(function (a) {
      var b = fmtButton(a[1], 'Align ' + a[0], function () { setAlign(a[0]); });
      alignBtns[a[0]] = b;
      row2.appendChild(b);
    });

    // Spacing nudges (padding + margin).
    var row3 = el('div', 'dm-fmt-row');
    row3.appendChild(fmtButton('P−', 'Less padding', function () { bumpPadding(-4); }));
    row3.appendChild(fmtButton('P+', 'More padding', function () { bumpPadding(4); }));
    row3.appendChild(fmtButton('M−', 'Less margin', function () { bumpMargin(-4); }));
    row3.appendChild(fmtButton('M+', 'More margin', function () { bumpMargin(4); }));

    // Corner radius + duplicate.
    var row4 = el('div', 'dm-fmt-row');
    row4.appendChild(fmtButton('R−', 'Less corner radius', function () { bumpRadius(-4); }));
    row4.appendChild(fmtButton('R+', 'More corner radius', function () { bumpRadius(4); }));
    row4.appendChild(fmtButton('⧉', 'Duplicate element', duplicateActive));

    var hint = el('div', 'dm-fmt-hint');
    hint.textContent = 'drag corner to resize · double-click to edit text';

    var delBtn = el('button', 'dm-fmt-btn dm-fmt-del');
    delBtn.type = 'button';
    delBtn.textContent = '🗑 Delete';
    delBtn.title = 'Remove this element';
    delBtn.addEventListener('click', deleteActive);

    panel.appendChild(fmtTitle);
    panel.appendChild(row1);
    panel.appendChild(row2);
    panel.appendChild(row3);
    panel.appendChild(row4);
    panel.appendChild(hint);
    panel.appendChild(delBtn);
    return panel;
  }

  function fmtButton(label, title, onClick) {
    var b = el('button', 'dm-fmt-btn');
    b.type = 'button';
    b.textContent = label;
    b.title = title;
    b.addEventListener('click', onClick);
    return b;
  }

  function el(tag, className) {
    var n = document.createElement(tag);
    if (className) n.className = className;
    return n;
  }

  function css() {
    return [
      ':host, * { box-sizing: border-box; }',
      '.dm-controls {',
      '  position: fixed; right: 16px; top: 50%; transform: translateY(-50%);',
      '  display: flex; flex-direction: column; gap: 10px; pointer-events: auto;',
      '  font: 13px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;',
      '}',
      '.dm-btn {',
      '  position: relative; display: flex; align-items: center; gap: 8px;',
      '  padding: 10px 14px; border: none; border-radius: 12px; cursor: pointer;',
      '  background: #1e1e28; color: #fff; font-size: 13px; font-weight: 600;',
      '  box-shadow: 0 6px 20px rgba(0,0,0,.28); transition: transform .08s, background .15s;',
      '}',
      '.dm-btn:hover { transform: translateX(-2px); }',
      '.dm-btn:active { transform: translateX(0) scale(.97); }',
      '.dm-btn svg { width: 16px; height: 16px; flex: none; }',
      '.dm-select.active { background: #4f46e5; box-shadow: 0 6px 22px rgba(79,70,229,.5); }',
      '.dm-copywrap { display: flex; flex-direction: column; align-items: stretch; gap: 4px; }',
      '.dm-copy { background: #0f9d58; }',
      '.dm-badge {',
      '  position: absolute; top: -7px; right: -7px; min-width: 18px; height: 18px;',
      '  padding: 0 4px; border-radius: 9px; background: #ff5a5f; color: #fff;',
      '  font-size: 11px; font-weight: 700; display: flex; align-items: center; justify-content: center;',
      '}',
      '.dm-clear {',
      '  background: none; border: none; color: rgba(255,255,255,.75); cursor: pointer;',
      '  font-size: 11px; text-align: center; text-decoration: underline; padding: 2px;',
      '  text-shadow: 0 1px 2px rgba(0,0,0,.4);',
      '}',
      '.dm-clear:hover { color: #fff; }',
      '.dm-highlight {',
      '  position: fixed; pointer-events: none; z-index: 1; display: none;',
      '  border: 2px solid #4f46e5; border-radius: 4px;',
      '  background: rgba(79,70,229,.12); box-shadow: 0 0 0 1px rgba(255,255,255,.5) inset;',
      '  transition: all .04s linear;',
      '}',
      '.dm-label {',
      '  position: fixed; pointer-events: none; z-index: 2; display: none;',
      '  max-width: 380px; padding: 5px 9px; border-radius: 7px;',
      '  background: #1e1e28; color: #fff; font: 12px/1.3 ui-monospace, "SF Mono", Menlo, monospace;',
      '  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;',
      '  box-shadow: 0 4px 14px rgba(0,0,0,.35);',
      '}',
      '.dm-label b { color: #a5b4fc; }',
      '.dm-label .dm-txt { color: #86efac; }',
      '.dm-selbox {',
      '  position: fixed; pointer-events: none; z-index: 2; display: none;',
      '  border: 2px solid #0f9d58; border-radius: 3px;',
      '}',
      '.dm-handle {',
      '  position: absolute; width: 12px; height: 12px; background: #0f9d58;',
      '  border: 2px solid #fff; border-radius: 3px; pointer-events: auto;',
      '  box-shadow: 0 1px 4px rgba(0,0,0,.4);',
      '}',
      '.dm-handle-e  { right: -7px; top: 50%; margin-top: -6px; cursor: ew-resize; }',
      '.dm-handle-s  { bottom: -7px; left: 50%; margin-left: -6px; cursor: ns-resize; }',
      '.dm-handle-se { right: -7px; bottom: -7px; cursor: nwse-resize; }',
      '.dm-format {',
      '  display: none; flex-direction: column; gap: 6px; margin-top: 4px;',
      '  padding: 10px; border-radius: 12px; background: #1e1e28; pointer-events: auto;',
      '  box-shadow: 0 6px 20px rgba(0,0,0,.28);',
      '}',
      '.dm-format.show { display: flex; }',
      '.dm-fmt-title {',
      '  color: #86efac; font: 11px/1.3 ui-monospace, Menlo, monospace;',
      '  max-width: 150px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;',
      '}',
      '.dm-fmt-row { display: flex; gap: 6px; }',
      '.dm-fmt-btn {',
      '  flex: 1; min-width: 34px; height: 30px; border: none; border-radius: 8px; cursor: pointer;',
      '  background: #2c2f3a; color: #e9ecf5; font-size: 14px; line-height: 1;',
      '  display: flex; align-items: center; justify-content: center;',
      '}',
      '.dm-fmt-btn:hover { background: #3a3e4c; }',
      '.dm-fmt-btn.active { background: #4f46e5; color: #fff; }',
      '.dm-fmt-del { background: #3a2226; color: #ff8a8f; font-size: 12px; }',
      '.dm-fmt-del:hover { background: #ef4444; color: #fff; }',
      '.dm-fmt-hint { color: rgba(255,255,255,.45); font-size: 10px; text-align: center; }',
      '.dm-toast {',
      '  position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%) translateY(20px);',
      '  background: #1e1e28; color: #fff; padding: 10px 16px; border-radius: 10px;',
      '  font: 13px -apple-system, sans-serif; box-shadow: 0 8px 28px rgba(0,0,0,.4);',
      '  opacity: 0; pointer-events: none; transition: opacity .2s, transform .2s;',
      '}',
      '.dm-toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }'
    ].join('\n');
  }

  function icon(name) {
    if (name === 'cursor') {
      return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l7.5 18 2.5-7 7-2.5z"/></svg>';
    }
    // copy
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';
  }

  // ---------------------------------------------------------------------------
  // Select mode (stays ON until toggled off — pick and move as many as you like)
  // ---------------------------------------------------------------------------
  function setSelecting(on) {
    selecting = on;
    selectBtn.classList.toggle('active', on);
    document.body.style.cursor = on ? 'crosshair' : '';
    if (on) {
      toastMsg('Select mode on — click any element to move & format it. Click Select again to finish.');
    } else {
      hideHighlight();
      setActive(null);
    }
  }

  function isOurs(node) {
    // True if the node lives inside our shadow host (or is the host itself).
    if (!node) return false;
    if (node === host) return true;
    var root = node.getRootNode && node.getRootNode();
    return root === shadow;
  }

  function onHoverMove(e) {
    if (!selecting || dragging) return;
    var target = e.target;
    if (isOurs(target) || target === document.documentElement || target === document.body) {
      hideHighlight();
      return;
    }
    showHighlight(target, e.clientX, e.clientY);
  }

  function showHighlight(target, mx, my) {
    var r = target.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) { hideHighlight(); return; }
    highlightBox.style.display = 'block';
    highlightBox.style.left = r.left + 'px';
    highlightBox.style.top = r.top + 'px';
    highlightBox.style.width = r.width + 'px';
    highlightBox.style.height = r.height + 'px';

    labelEl.style.display = 'block';
    labelEl.innerHTML = shortLabel(target);
    // Position label near cursor, kept on-screen.
    var lx = (mx == null ? r.left : mx + 14);
    var ly = (my == null ? r.top - 26 : my + 16);
    var lw = labelEl.offsetWidth || 200;
    if (lx + lw > window.innerWidth - 8) lx = window.innerWidth - lw - 8;
    if (ly + 26 > window.innerHeight - 8) ly = my - 30;
    labelEl.style.left = Math.max(8, lx) + 'px';
    labelEl.style.top = Math.max(8, ly) + 'px';
    highlightBox._target = target;
  }

  function hideHighlight() {
    highlightBox.style.display = 'none';
    labelEl.style.display = 'none';
    highlightBox._target = null;
  }

  function reposition() {
    if (selecting && !dragging && highlightBox._target) {
      showHighlight(highlightBox._target, null, null);
    }
    if (activeEl && !dragging) showSelection();
  }

  // In select mode, pressing any element makes it the active element and starts
  // dragging it. Mode stays on, so afterwards you can press another straight away.
  function onSelectPointerDown(e) {
    if (!selecting || e.button !== 0) return;
    var target = e.target;
    if (isOurs(target)) return;               // let our own buttons / handles work
    if (target.isContentEditable) return;     // let text editing use the pointer
    if (editingEl && editingEl.contains(target)) return;
    if (target === document.documentElement || target === document.body) return;
    if (editingEl) endEdit();                 // clicking elsewhere commits the edit
    e.preventDefault();
    e.stopPropagation();
    setActive(target);
    hideHighlight();
    startDrag(target, e);
  }

  // ---------------------------------------------------------------------------
  // Active element: persistent outline + resize handles + formatting panel
  // ---------------------------------------------------------------------------
  function setActive(elm) {
    activeEl = elm;
    if (elm) {
      if (!selected.has(elm)) selected.add(elm);
      ensureSnapshot(elm);
      showSelection();
      fmtTitle.textContent = stripTagsText(shortLabel(elm));
      formatPanel.classList.add('show');
      syncFormatButtons();
    } else {
      hideSelection();
      formatPanel.classList.remove('show');
    }
  }

  function showSelection() {
    if (!activeEl) return;
    var r = activeEl.getBoundingClientRect();
    selBox.style.display = 'block';
    selBox.style.left = r.left + 'px';
    selBox.style.top = r.top + 'px';
    selBox.style.width = r.width + 'px';
    selBox.style.height = r.height + 'px';
  }

  function hideSelection() {
    selBox.style.display = 'none';
  }

  function syncFormatButtons() {
    if (!activeEl) return;
    var cs = getComputedStyle(activeEl);
    boldBtn.classList.toggle('active', parseInt(cs.fontWeight, 10) >= 600);
    Object.keys(alignBtns).forEach(function (k) {
      alignBtns[k].classList.toggle('active', cs.textAlign === k);
    });
  }

  // ---------------------------------------------------------------------------
  // Formatting operations (each records into the element's change record)
  // ---------------------------------------------------------------------------
  function toggleBold() {
    if (!activeEl) return;
    var isBold = parseInt(getComputedStyle(activeEl).fontWeight, 10) >= 600;
    activeEl.style.fontWeight = isBold ? 'normal' : 'bold';
    styleChanged(activeEl, 'fontWeight', activeEl.style.fontWeight);
    syncFormatButtons();
    showSelection();
  }

  function bumpFont(delta) {
    if (!activeEl) return;
    var px = Math.round(parseFloat(getComputedStyle(activeEl).fontSize)) + delta;
    px = Math.max(6, px);
    activeEl.style.fontSize = px + 'px';
    styleChanged(activeEl, 'fontSize', px + 'px');
    showSelection();
    toastMsg('Font size ' + px + 'px');
  }

  function setAlign(dir) {
    if (!activeEl) return;
    activeEl.style.textAlign = dir;
    styleChanged(activeEl, 'textAlign', dir);
    syncFormatButtons();
  }

  function deleteActive() {
    if (!activeEl) return;
    var elm = activeEl;
    ensureSnapshot(elm);
    var rec = getRec(elm);
    rec.deleted = true;
    elm.style.display = 'none';   // preview the removal (reset restores it)
    updateBadge();
    setActive(null);
    toastMsg('Deleted ' + leafLabel(elm) + ' — use clear to bring it back.');
  }

  function styleChanged(elm, prop, value) {
    var rec = getRec(elm);
    rec.style[prop] = value;
    updateBadge();
  }

  // Nudge all four sides of a box property by delta, preserving asymmetry.
  function nudgeBox(prop, delta) {
    if (!activeEl) return null;
    ensureSnapshot(activeEl);
    var cs = getComputedStyle(activeEl);
    var cap = prop.charAt(0).toUpperCase() + prop.slice(1);
    var sides = ['Top', 'Right', 'Bottom', 'Left'].map(function (s) {
      return Math.max(0, Math.round(parseFloat(cs[prop + s]) || 0) + delta);
    });
    var value = sides.join('px ') + 'px';
    activeEl.style[prop] = value;
    styleChanged(activeEl, prop, value);
    showSelection();
    return value;
  }

  function bumpPadding(delta) {
    if (nudgeBox('padding', delta) != null) toastMsg('Padding ' + (delta > 0 ? '+' : '') + delta + 'px');
  }

  function bumpMargin(delta) {
    // Margin nudges intentionally reflow the page (spacing IS layout); this
    // overrides the resize footprint-freeze margins, which is fine.
    if (nudgeBox('margin', delta) != null) toastMsg('Margin ' + (delta > 0 ? '+' : '') + delta + 'px');
  }

  function bumpRadius(delta) {
    if (!activeEl) return;
    ensureSnapshot(activeEl);
    var px = Math.max(0, Math.round(parseFloat(getComputedStyle(activeEl).borderTopLeftRadius) || 0) + delta);
    activeEl.style.borderRadius = px + 'px';
    styleChanged(activeEl, 'borderRadius', px + 'px');
    showSelection();
    toastMsg('Corner radius ' + px + 'px');
  }

  function duplicateActive() {
    if (!activeEl || !activeEl.parentNode) return;
    var clone = activeEl.cloneNode(true);
    clone.style.transform = '';        // don't inherit our move offset
    clone.setAttribute('data-dm-clone', '');
    activeEl.parentNode.insertBefore(clone, activeEl.nextSibling);
    dupNodes.push(clone);
    var rec = getRec(activeEl);
    rec.duplicated = (rec.duplicated || 0) + 1;
    updateBadge();
    showSelection();
    toastMsg('Duplicated ' + leafLabel(activeEl) + ' (×' + rec.duplicated + ')');
  }

  // ---------------------------------------------------------------------------
  // Inline text editing (double-click a leaf element)
  // ---------------------------------------------------------------------------
  function onDblClick(e) {
    if (!selecting) return;
    var target = e.target;
    if (isOurs(target) || target === document.body || target === document.documentElement) return;
    if (target.childElementCount !== 0) return;   // only leaf (text-only) elements
    e.preventDefault();
    e.stopPropagation();
    setActive(target);
    startEdit(target);
  }

  function startEdit(elm) {
    if (editingEl) endEdit();
    editingEl = elm;
    ensureSnapshot(elm);
    var rec = getRec(elm);
    if (rec.textFrom == null) rec.textFrom = elm.textContent;
    elm.setAttribute('contenteditable', 'true');
    elm.style.cursor = 'text';
    elm.focus();
    selectAll(elm);
    elm.addEventListener('blur', endEdit, { once: true });
    toastMsg('Editing text — click away or press Esc to finish.');
  }

  function selectAll(elm) {
    try {
      var range = document.createRange();
      range.selectNodeContents(elm);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (_) {}
  }

  function endEdit() {
    if (!editingEl) return;
    var elm = editingEl;
    editingEl = null;
    elm.removeAttribute('contenteditable');
    elm.style.cursor = '';
    var rec = getRec(elm);
    var now = elm.textContent;
    if (now !== rec.textFrom) {
      rec.textTo = now;
      updateBadge();
      toastMsg('Text updated');
    } else {
      rec.textTo = undefined;
    }
    showSelection();
  }

  // ---------------------------------------------------------------------------
  // Resize (drag a handle on the selection box)
  // ---------------------------------------------------------------------------
  function startResize(e, dir) {
    if (!activeEl) return;
    e.preventDefault();
    e.stopPropagation();
    try { e.target.setPointerCapture(e.pointerId); } catch (_) {}
    ensureSnapshot(activeEl);
    dragging = true;
    var target = activeEl;
    // Freeze the current box size as the resize baseline (border-box so width maps 1:1).
    var r = target.getBoundingClientRect();
    target.style.boxSizing = 'border-box';
    var startW = r.width, startH = r.height;
    var startX = e.clientX, startY = e.clientY;

    function move(ev) {
      var w = startW, h = startH;
      if (dir === 'e' || dir === 'se') w = Math.max(16, Math.round(startW + (ev.clientX - startX)));
      if (dir === 's' || dir === 'se') h = Math.max(16, Math.round(startH + (ev.clientY - startY)));
      target.style.width = w + 'px';
      target.style.height = h + 'px';
      freezeFootprint(target, w, h);
      showSelection();
    }
    function up() {
      document.removeEventListener('pointermove', move, true);
      document.removeEventListener('pointerup', up, true);
      dragging = false;
      var rec = getRec(target);
      rec.style.width = target.style.width;
      rec.style.height = target.style.height;
      updateBadge();
      showSelection();
      toastMsg('Resized to ' + target.style.width + ' × ' + target.style.height);
    }
    document.addEventListener('pointermove', move, true);
    document.addEventListener('pointerup', up, true);
  }

  // Keep the element's layout footprint fixed at its original size by cancelling
  // the growth with negative margins — so a resize overlaps neighbours instead of
  // pushing the rest of the page around (same spirit as the transform-based move).
  function freezeFootprint(target, w, h) {
    var snap = target.__dmSnap;
    if (!snap) return;
    target.style.marginRight = (snap.cMarginRight - (w - snap.baseW)) + 'px';
    target.style.marginBottom = (snap.cMarginBottom - (h - snap.baseH)) + 'px';
  }

  // Swallow the click that follows a select/drag so page links/buttons don't fire.
  function onSwallowClick(e) {
    if (!selecting) return;
    if (isOurs(e.target)) return;
    if (e.target.isContentEditable) return;   // allow cursor placement while editing
    e.preventDefault();
    e.stopPropagation();
  }

  function onKey(e) {
    if (e.key === 'Escape') {
      if (editingEl) { endEdit(); e.stopPropagation(); return; }
      if (selecting) setSelecting(false);
    } else if (e.key === 'Enter' && editingEl && !e.shiftKey) {
      e.preventDefault();
      endEdit();
    }
  }

  // ---------------------------------------------------------------------------
  // Dragging (native Pointer Events, transform on the REAL element)
  //
  // We translate the original element in place with a CSS transform. Transforms
  // don't affect layout, so the element's slot never collapses AND it keeps all
  // of its styles, DOM context, and event handlers (no clone in a shadow root
  // where page CSS can't reach it). Re-dragging just continues from the last
  // offset, so a move can be corrected any number of times.
  // ---------------------------------------------------------------------------
  // Snapshot every inline style we might change, once, so reset is exact.
  function ensureSnapshot(target) {
    if (target.__dmSnap) return;
    var s = target.style;
    var cs = getComputedStyle(target);
    target.__dmSnap = {
      position: s.position, zIndex: s.zIndex, transform: s.transform,
      transition: s.transition, cursor: s.cursor,
      fontWeight: s.fontWeight, fontSize: s.fontSize, textAlign: s.textAlign,
      width: s.width, height: s.height, boxSizing: s.boxSizing, display: s.display,
      padding: s.padding, margin: s.margin, borderRadius: s.borderRadius,
      // Originals used to freeze the layout footprint while resizing.
      marginRight: s.marginRight, marginBottom: s.marginBottom,
      cMarginRight: parseFloat(cs.marginRight) || 0,
      cMarginBottom: parseFloat(cs.marginBottom) || 0,
      baseW: target.offsetWidth, baseH: target.offsetHeight
    };
  }

  // Lift the element into a positioned, high-z context once, so it floats above
  // its siblings while moved.
  function ensureLifted(target) {
    if (target.__dmLifted) return;
    target.__dmLifted = true;
    ensureSnapshot(target);
    if (getComputedStyle(target).position === 'static') target.style.position = 'relative';
    target.style.zIndex = String(Z - 1000);   // above the page, below our UI
    target.style.transition = 'none';
  }

  function applyTransform(target, dx, dy) {
    var base = (target.__dmSnap && target.__dmSnap.transform) || '';
    target.style.transform = (base ? base + ' ' : '') + 'translate(' + dx + 'px, ' + dy + 'px)';
  }

  // Get (or lazily create) the change record for an element.
  function getRec(elm) {
    var rec = moves.get(elm);
    if (!rec) {
      rec = { selector: uniqueSelector(elm), label: leafLabel(elm), style: {} };
      moves.set(elm, rec);
    }
    return rec;
  }

  function currentOffset(target) {
    var rec = moves.get(target);
    return rec ? { dx: rec.dx, dy: rec.dy } : { dx: 0, dy: 0 };
  }

  function startDrag(target, e) {
    try { target.setPointerCapture(e.pointerId); } catch (_) {}

    ensureLifted(target);
    dragging = true;
    hideSelection();
    target.style.cursor = 'grabbing';

    var off = currentOffset(target);
    var baseDx = off.dx, baseDy = off.dy;
    var startX = e.clientX, startY = e.clientY;
    var curDx = baseDx, curDy = baseDy;
    var moved = false;

    function move(ev) {
      curDx = baseDx + (ev.clientX - startX);
      curDy = baseDy + (ev.clientY - startY);
      if (Math.abs(curDx - baseDx) > 2 || Math.abs(curDy - baseDy) > 2) moved = true;
      applyTransform(target, curDx, curDy);
    }

    function up() {
      document.removeEventListener('pointermove', move, true);
      document.removeEventListener('pointerup', up, true);
      dragging = false;
      target.style.cursor = 'grab';

      curDx = Math.round(curDx);
      curDy = Math.round(curDy);
      applyTransform(target, curDx, curDy);

      if (moved || (moves.has(target) && moves.get(target).dx != null)) {
        var rec = getRec(target);
        rec.dx = curDx;
        rec.dy = curDy;
        rec.neighbor = detectNeighbor(target);
        updateBadge();
        toastMsg('Moved ' + leafLabel(target) + '  (' + fmtDelta(curDx, curDy) + ')');
      } else {
        toastMsg('Selected ' + leafLabel(target) + ' — drag to move, or format it.');
      }
      showSelection();
    }

    document.addEventListener('pointermove', move, true);
    document.addEventListener('pointerup', up, true);
  }

  // What element is under the moved element's center now? (hide it for the probe)
  function detectNeighbor(self) {
    var r = self.getBoundingClientRect();
    var cx = r.left + r.width / 2;
    var cy = r.top + r.height / 2;
    var prevVis = self.style.visibility;
    self.style.visibility = 'hidden';
    var under = document.elementFromPoint(cx, cy);
    self.style.visibility = prevVis;
    if (!under || isOurs(under) || under === self || self.contains(under) || under.contains(self)) {
      return null;
    }
    var nr = under.getBoundingClientRect();
    var position = cy < nr.top + nr.height / 2 ? 'before' : 'after';
    return {
      selector: uniqueSelector(under),
      label: leafLabel(under),
      position: position
    };
  }

  function updateBadge() {
    countBadge.textContent = String(moves.size);
    countBadge.style.display = moves.size ? 'flex' : 'none';
  }

  // ---------------------------------------------------------------------------
  // Selector generation
  // ---------------------------------------------------------------------------
  function goodClass(elm) {
    if (!elm.classList || !elm.classList.length) return null;
    for (var i = 0; i < elm.classList.length; i++) {
      var c = elm.classList[i];
      // Skip our own + obviously dynamic/util-noise classes.
      if (/^dm-/.test(c)) continue;
      if (/^(active|open|show|hidden|selected|is-|has-)/.test(c)) continue;
      if (/\d{3,}/.test(c)) continue; // hashed
      return c;
    }
    return elm.classList[0] || null;
  }

  function nthOfType(elm) {
    var i = 1, sib = elm;
    while ((sib = sib.previousElementSibling)) {
      if (sib.tagName === elm.tagName) i++;
    }
    return i;
  }

  // Short, human-readable breadcrumb (returns HTML with light markup).
  function shortLabel(elm) {
    var chain = [];
    var node = elm, depth = 0;
    while (node && node.nodeType === 1 && node !== document.body && depth < 3) {
      chain.unshift(node);
      node = node.parentElement;
      depth++;
    }
    var parts = chain.map(function (n, idx) {
      var tag = n.tagName.toLowerCase();
      var token = tag;
      if (n.id) token = tag + '#' + n.id;
      else {
        var c = goodClass(n);
        if (c) token = tag + '.' + c;
      }
      // add short text for leaf if it's a link/button/heading
      var out = '<b>' + escapeHtml(token) + '</b>';
      if (idx === chain.length - 1) {
        var t = leafText(n);
        if (t) out += ' <span class="dm-txt">"' + escapeHtml(t) + '"</span>';
      }
      return out;
    });
    return parts.join(' <span style="opacity:.5">›</span> ');
  }

  // Compact single-element label for the export/toast, e.g. a.btn "Book a demo".
  function leafLabel(n) {
    var tag = n.tagName.toLowerCase();
    var token = tag;
    if (n.id) token = tag + '#' + n.id;
    else {
      var c = goodClass(n);
      if (c) token = tag + '.' + c;
    }
    var t = leafText(n);
    return t ? token + ' "' + t + '"' : token;
  }

  function leafText(n) {
    var tag = n.tagName.toLowerCase();
    if (!/^(a|button|h1|h2|h3|h4|h5|h6|span|li|label|p|strong)$/.test(tag)) return '';
    var t = (n.textContent || '').trim().replace(/\s+/g, ' ');
    if (!t) return '';
    return t.length > 24 ? t.slice(0, 24) + '…' : t;
  }

  // Robust-ish unique CSS path (finder-style, kept short).
  function uniqueSelector(elm) {
    if (elm.id && isUnique('#' + cssEscape(elm.id))) return '#' + cssEscape(elm.id);
    var parts = [];
    var node = elm;
    while (node && node.nodeType === 1 && node !== document.documentElement) {
      var seg = node.tagName.toLowerCase();
      if (node.id) {
        seg = '#' + cssEscape(node.id);
        parts.unshift(seg);
        if (isUnique(parts.join(' > '))) return parts.join(' > ');
        break;
      }
      var c = goodClass(node);
      if (c) seg += '.' + cssEscape(c);
      // disambiguate among same-type siblings
      var sameType = node.parentElement
        ? Array.prototype.filter.call(node.parentElement.children, function (ch) {
            return ch.tagName === node.tagName;
          }).length
        : 1;
      if (sameType > 1) seg += ':nth-of-type(' + nthOfType(node) + ')';
      parts.unshift(seg);
      if (isUnique(parts.join(' > '))) return parts.join(' > ');
      node = node.parentElement;
    }
    return parts.join(' > ');
  }

  function isUnique(sel) {
    try { return document.querySelectorAll(sel).length === 1; }
    catch (e) { return false; }
  }

  function cssEscape(s) {
    if (window.CSS && CSS.escape) return CSS.escape(s);
    return String(s).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
  }

  // ---------------------------------------------------------------------------
  // Summary export
  // ---------------------------------------------------------------------------
  function buildSummary() {
    if (!moves.size) return '';
    var n = moves.size;
    var lines = [
      "I've moved elements around on " + location.href + " to explain the idea of the visual",
      'changes I want you to perform. I used the Dom Mover lib for it.',
      '',
      'These are not the literal pixels the changes must be made by, but a direction. You need to',
      'infer whether each change can be made by just adjusting CSS (alignment, spacing, size) or by',
      'restructuring the DOM elements.',
      '',
      'Changes (' + n + ' element' + (n > 1 ? 's' : '') + '):',
      ''
    ];
    var i = 0;
    moves.forEach(function (rec) {
      i++;
      lines.push(i + '. ' + rec.label);
      lines.push('   selector: ' + rec.selector);
      if (rec.deleted) {
        lines.push('   action: DELETE — remove this element');
        lines.push('');
        return;
      }
      if (rec.dx != null || rec.dy != null) {
        lines.push('   moved: ' + fmtDelta(rec.dx || 0, rec.dy || 0));
        if (rec.neighbor) {
          lines.push('   now near: ' + rec.neighbor.position + ' ' + rec.neighbor.label +
            '  (' + rec.neighbor.selector + ')');
        }
      }
      if (rec.textTo != null && rec.textTo !== rec.textFrom) {
        lines.push('   text: "' + rec.textFrom + '" → "' + rec.textTo + '"');
      }
      var st = fmtStyle(rec.style);
      if (st) lines.push('   style: ' + st);
      if (rec.duplicated) {
        lines.push('   action: duplicate — add ' + rec.duplicated + ' more cop' +
          (rec.duplicated > 1 ? 'ies' : 'y') + ' of this element');
      }
      lines.push('');
    });
    return lines.join('\n').trim() + '\n';
  }

  function fmtStyle(style) {
    if (!style) return '';
    var parts = [];
    if (style.fontWeight) parts.push('font-weight ' + style.fontWeight);
    if (style.fontSize) parts.push('font-size ' + style.fontSize);
    if (style.textAlign) parts.push('text-align ' + style.textAlign);
    if (style.padding) parts.push('padding ' + style.padding);
    if (style.margin) parts.push('margin ' + style.margin);
    if (style.borderRadius) parts.push('border-radius ' + style.borderRadius);
    if (style.width || style.height) {
      parts.push('size ' + (style.width || 'auto') + ' × ' + (style.height || 'auto'));
    }
    return parts.join('; ');
  }

  function fmtDelta(dx, dy) {
    var parts = [];
    if (dx) parts.push(Math.abs(dx) + 'px ' + (dx > 0 ? 'right' : 'left'));
    if (dy) parts.push(Math.abs(dy) + 'px ' + (dy > 0 ? 'down' : 'up'));
    if (!parts.length) return 'no net offset';
    return parts.join(', ');
  }

  function copySummary() {
    var text = buildSummary();
    if (!text) { toastMsg('No changes yet — select an element, then move or format it.'); return; }
    writeClipboard(text).then(function (ok) {
      toastMsg(ok ? 'Copied ' + moves.size + ' change' + (moves.size > 1 ? 's' : '') + ' to clipboard'
                  : 'Copy failed — see console.');
      if (!ok) console.log('[dom-mover] summary:\n' + text);
    });
  }

  function writeClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { return true; },
        function () { return legacyCopy(text); });
    }
    return Promise.resolve(legacyCopy(text));
  }

  function legacyCopy(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;left:-9999px;top:0;';
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (e) { return false; }
  }

  // ---------------------------------------------------------------------------
  // Reset
  // ---------------------------------------------------------------------------
  function resetAll() {
    endEdit();
    // Remove any duplicated clones we inserted.
    dupNodes.forEach(function (n) { if (n.parentNode) n.parentNode.removeChild(n); });
    dupNodes = [];
    // Restore every element we touched to its original inline styles + text.
    selected.forEach(function (elm) {
      var s = elm.__dmSnap;
      if (s) {
        elm.style.transform = s.transform;
        elm.style.position = s.position;
        elm.style.zIndex = s.zIndex;
        elm.style.transition = s.transition;
        elm.style.cursor = s.cursor;
        elm.style.fontWeight = s.fontWeight;
        elm.style.fontSize = s.fontSize;
        elm.style.textAlign = s.textAlign;
        elm.style.width = s.width;
        elm.style.height = s.height;
        elm.style.boxSizing = s.boxSizing;
        elm.style.margin = s.margin;
        elm.style.marginRight = s.marginRight;
        elm.style.marginBottom = s.marginBottom;
        elm.style.padding = s.padding;
        elm.style.borderRadius = s.borderRadius;
        elm.style.display = s.display;
      }
      var rec = moves.get(elm);
      if (rec && rec.textFrom != null && elm.childElementCount === 0) {
        elm.textContent = rec.textFrom;
      }
      elm.removeAttribute('contenteditable');
      elm.__dmSnap = null;
      elm.__dmLifted = false;
    });
    setActive(null);
    selected.clear();
    moves.clear();
    updateBadge();
    hideHighlight();
    toastMsg('Cleared all changes');
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  var toastTimer;
  function toastMsg(msg) {
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toast.classList.remove('show'); }, 2200);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
  }

  function stripTagsText(html) {
    var d = document.createElement('div');
    d.innerHTML = html;
    return (d.textContent || '').trim();
  }

  // Expose a tiny API for debugging / integration.
  window.domMover = {
    summary: buildSummary,
    reset: resetAll,
    moves: moves,
    toggleSelect: function () { setSelecting(!selecting); }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
