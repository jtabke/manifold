# 0043: Personal dockable workspace chrome

Status: Accepted for the in-app canvas shell.

## Context

The freeform canvas is the default. Users also need recoverable, configurable toolbars
and supporting panels, without moving engineering objects or changing a downloaded file.
The optional multi-editor arrangements and portable authored scene layouts already serve
different purposes; neither should become an owner of application chrome.

## Decision

Keep toolbar position, panel dock/tab/collapse/size and up to twelve named presets in a
single bounded, versioned personal preference (`manifold.workspace-chrome.v1`). The
`useWorkspaceChrome` publication point validates and persists before publishing live state.
Failed saves leave both live state and the last saved value unchanged. Unreadable stored
preferences are preserved until explicit Reset. Reset restores chrome, not document data,
and retains valid presets. Existing multi-editor arrangements remain independent and available.

The application composition root reuses the relationship/result/table representations and
assistant ports. Docking changes no session records, Undo history, camera or source identity.
Stable DOM portal hosts move toolbar and panel content without remounting the canvas,
drawing tools or assistant. Tab switching/collapse parks inactive content hidden, preserving
drafts; explicitly closing the assistant retains its existing disconnect/unmount semantics.

Panels dock left, right or bottom and share a tab group per edge. Toolbars can also dock top
or hide. Labelled native drag destinations have ordinary control alternatives. Panel tabs
and resize boundaries support keyboard input. Resize is a pointer-owned local preview;
release commits once, while Escape, cancellation, capture loss and window blur discard it.
On narrow screens, side panels overlay rather than consume the central canvas width.
The header's View control remains reachable independently of toolbar visibility.

## Consequences and exclusions

Personal chrome is not a second authored layout owner: document geometry, named authored
layouts, file handoff and computational execution continue through their existing ports.
No new dependency, general split-tree layout, floating OS window, cross-device preference
synchronization or multi-window assistant is introduced. Native drag is complemented by
selectors for keyboard and touch; freely floating in-app windows are not included.

The local `check-workspace-chrome` contract covers layout validation and immutable docking;
the corresponding browser contract covers actual edge dragging, tab/collapse/resize,
toolbar placement, canvas/draft continuity, presets, reload and recovery.
