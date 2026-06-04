# Resizable Panels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add desktop mouse resizing for the project sidebar and the account/detail split.

**Architecture:** Keep the current fixed sidebar and content grid. Add two resize handles in the existing HTML, drive panel widths from JavaScript state, expose the active values through CSS custom properties on `#appView`, and persist final drag widths through `preferences.panelLayout`.

**Tech Stack:** Plain HTML, CSS, browser JavaScript, Node `node:test` static tests.

---

### Task 1: Add Failing Static Coverage

**Files:**
- Modify: `tests/browser-storage-policy.test.js`

- [ ] **Step 1: Write the failing test**

Append a test named `dashboard panels expose desktop mouse resize controls`. It should read `public/index.html`, `public/app.js`, and `public/styles.css`, then assert the presence of:

- `sidebarResizeHandle`
- `detailResizeHandle`
- `sidebarWidth`
- `detailPanelWidth`
- `bindPanelResizeActions`
- `updatePanelWidths`
- `--project-sidebar-width`
- `--detail-panel-width`
- `.panel-resize-handle`
- mobile CSS hiding resize handles

- [ ] **Step 2: Run the focused test file**

Run: `node --test tests/browser-storage-policy.test.js`

Expected: FAIL because resize handles and resize functions do not exist yet.

### Task 2: Add Resize Markup

**Files:**
- Modify: `public/index.html`

- [ ] **Step 1: Add sidebar handle**

Inside `<section class="project-strip">`, after `.strip-left`, add:

```html
<button id="sidebarResizeHandle" class="panel-resize-handle sidebar-resize-handle" type="button" aria-label="Kéo để đổi độ rộng danh sách dự án" title="Kéo để đổi độ rộng danh sách dự án"></button>
```

- [ ] **Step 2: Add detail split handle**

Inside `<section class="content-body">`, between `.grid-area` and `#detailAside`, add:

```html
<button id="detailResizeHandle" class="panel-resize-handle detail-resize-handle" type="button" aria-label="Kéo để đổi độ rộng chi tiết account" title="Kéo để đổi độ rộng chi tiết account"></button>
```

### Task 3: Implement Resize State And Events

**Files:**
- Modify: `public/app.js`

- [ ] **Step 1: Add state and constants**

Add state keys `sidebarWidth`, `detailPanelWidth`, and `panelLayoutPreferenceTimer`. Add constants:

```js
const SIDEBAR_COLLAPSED_WIDTH = 56;
const PANEL_MIN_WIDTH = 10;
```

- [ ] **Step 2: Bind handlers**

Call `bindPanelResizeActions()` inside `bindEvents()` before `syncSidebarState()`.

- [ ] **Step 3: Add helper functions**

Add:

```js
function clampNumber(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function maxDetailWidth() {
  const sidebarWidth = state.sidebarCollapsed ? SIDEBAR_COLLAPSED_WIDTH : state.sidebarWidth;
  return Math.max(PANEL_MIN_WIDTH, Math.floor(window.innerWidth - sidebarWidth - PANEL_MIN_WIDTH));
}

function updatePanelWidths() {
  state.sidebarWidth = clampNumber(state.sidebarWidth, PANEL_MIN_WIDTH, maxSidebarWidth());
  state.detailPanelWidth = clampNumber(state.detailPanelWidth, PANEL_MIN_WIDTH, maxDetailWidth());
  appView?.style.setProperty('--project-sidebar-width', `${state.sidebarCollapsed ? SIDEBAR_COLLAPSED_WIDTH : state.sidebarWidth}px`);
  appView?.style.setProperty('--detail-panel-width', `${state.detailPanelWidth}px`);
}
```

- [ ] **Step 4: Add pointer resize functions**

`bindPanelResizeActions()` attaches pointer handlers to both handles. Sidebar drag uses `event.clientX`. Detail drag uses `window.innerWidth - event.clientX`. Both call `updatePanelWidths()`.

- [ ] **Step 5: Sync collapsed state**

Update `syncSidebarState()` to call `updatePanelWidths()`, disable the sidebar handle when collapsed, and update ARIA state.

### Task 4: Implement CSS Layout

**Files:**
- Modify: `public/styles.css`

- [ ] **Step 1: Add app custom properties**

Add default variables on `.app`:

```css
.app {
  --project-sidebar-width: clamp(220px, 20vw, 320px);
  --project-sidebar-collapsed-width: 56px;
  --detail-panel-width: min(520px, 42vw);
}
```

- [ ] **Step 2: Replace fixed width formulas**

Use `var(--project-sidebar-width)` for sidebar width and content margins. Use `var(--project-sidebar-collapsed-width)` for collapsed widths.

- [ ] **Step 3: Add resize handle CSS**

Add `.panel-resize-handle`, `.sidebar-resize-handle`, `.detail-resize-handle`, and `.app.panel-resizing` rules.

- [ ] **Step 4: Use detail width variable**

When detail is open, set:

```css
.content-body:has(.detail-aside.open) {
  grid-template-columns: minmax(10px, 1fr) var(--detail-panel-width);
}
```

Show `.detail-resize-handle` only when detail is open.

- [ ] **Step 5: Preserve mobile**

In the existing `@media (max-width: 820px)`, hide `.panel-resize-handle` and keep content margins/detail slide-over as currently defined.

### Task 5: Persist Panel Layout Per User

**Files:**
- Modify: `public/app.js`
- Modify: `src/supabase-repositories.js`
- Test: `tests/browser-storage-policy.test.js`
- Test: `tests/routes.test.js`
- Test: `tests/supabase-repositories.test.js`

- [ ] **Step 1: Save frontend layout preferences after resize**

Add `currentPanelLayoutPreferences()`, `schedulePanelLayoutPreferenceSave()`, and `savePanelLayoutPreferences()`. `startPanelResize()` should call `schedulePanelLayoutPreferenceSave()` only when pointer movement occurred and the drag ends.

- [ ] **Step 2: Apply saved layout on login/session**

Extend `applyUserThemePreferences()` to call `applyUserPanelLayoutPreferences(preferences)`. Clamp saved values against the current viewport before setting CSS variables.

- [ ] **Step 3: Whitelist panel layout on the server**

Extend `sanitizeUserPreferences()` so `panelLayout.sidebarWidth` and `panelLayout.detailPanelWidth` are numeric, rounded, and clamped to at least `10`.

- [ ] **Step 4: Verify persistence tests**

Run:

```bash
node --test tests/browser-storage-policy.test.js tests/routes.test.js tests/supabase-repositories.test.js
```

Expected: PASS.

### Task 6: Verify And Commit

**Files:**
- Test: `tests/browser-storage-policy.test.js`
- Test: full project via `npm test`

- [ ] **Step 1: Run focused test**

Run: `node --test tests/browser-storage-policy.test.js`

Expected: PASS.

- [ ] **Step 2: Run full test suite**

Run: `npm test`

Expected: PASS.

- [ ] **Step 3: Commit implementation**

Run:

```bash
git add public/index.html public/styles.css public/app.js tests/browser-storage-policy.test.js docs/superpowers/plans/2026-06-04-resizable-panels.md
git commit -m "feat: add resizable dashboard panels"
```
