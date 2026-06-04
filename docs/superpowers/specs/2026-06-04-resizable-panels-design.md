# Resizable Panels Design

## Goal

Add mouse-driven resize controls for the dashboard's three working areas:

- Project sidebar on the left.
- System/account column in the center.
- Account detail panel on the right.

The existing sidebar collapse button remains available. Resize behavior is desktop-only; mobile keeps the current stacked/slide-over layout.

## Layout

The dashboard keeps the current topbar and fixed left project sidebar. Widths are controlled through CSS custom properties:

- `--project-sidebar-width`: expanded project sidebar width.
- `--project-sidebar-collapsed-width`: collapsed sidebar width.
- `--detail-panel-width`: right detail panel width when open.

The content header and content body use `--project-sidebar-width` for their left margin. When the sidebar is collapsed, they use `--project-sidebar-collapsed-width`.

When detail is open, the content body becomes two columns:

- System/account column: remaining available space.
- Detail panel: `--detail-panel-width`.

The left sidebar is project-only. Project systems are rendered in the center column as system items only. Selecting a system chooses that system's first visible account and keeps the existing account detail panel on the right.

## Resize Controls

There are two desktop resize handles:

- `sidebarResizeHandle`: positioned on the right edge of the project sidebar.
- `detailResizeHandle`: positioned between the account list and detail panel.

Dragging the sidebar handle changes `--project-sidebar-width`. Dragging the detail handle changes `--detail-panel-width`. Both values are clamped dynamically from the viewport so no panel uses a fixed maximum.

Panel constraints:

- Every visible panel can shrink to `10px`.
- Sidebar maximum is `viewport width - account minimum 10px - detail minimum 10px`.
- Detail maximum is `viewport width - current sidebar width - account minimum 10px`.
- Account list width is the remaining content space between sidebar and detail.
- Defaults remain comfortable for first load: sidebar `clamp(220px, 20vw, 320px)`, detail `min(520px, 42vw)`.

## Collapse Behavior

The existing sidebar toggle continues to collapse the project area to `56px`. While collapsed:

- Sidebar resize is disabled.
- The previous expanded sidebar width is kept in memory.
- Expanding the sidebar restores the previous width.

## Persistence

Panel widths are stored per user through the existing `/api/me/preferences` endpoint. The frontend keeps the active widths in JavaScript state while the user is working, then saves `preferences.panelLayout` when a resize drag finishes:

```json
{
  "panelLayout": {
    "sidebarWidth": 280,
    "detailPanelWidth": 520
  }
}
```

When the user logs in or refreshes the app, `state.currentUser.preferences.panelLayout` is applied before rendering the dashboard widths. Browser storage remains unused.

## Mobile Behavior

Under the existing mobile breakpoint:

- Resize handles are hidden.
- Project sidebar uses the current horizontal/static mobile layout.
- Detail panel keeps the current fixed slide-over behavior.
- CSS variables do not override mobile widths.

## Testing

Static tests should cover:

- Both resize handles exist in the HTML with accessible labels.
- JavaScript defines resize state, min/max constraints, pointer event handlers, and CSS variable updates.
- Sidebar collapse disables sidebar resizing and preserves expanded width.
- CSS uses custom properties for sidebar and detail widths.
- Sidebar project chips do not render system submenus; systems render in the center column.
- Panel widths persist through `preferences.panelLayout` for the current user.
- Mobile media query hides resize handles and preserves the current mobile layout.
- Browser storage policy remains unchanged: no `localStorage`, `sessionStorage`, or cookies for panel widths.
