import TaskList from "@tiptap/extension-task-list"
import TaskItem from "@tiptap/extension-task-item"
import { mergeAttributes } from "@tiptap/react"

// TipTap's default TaskList/TaskItem renderHTML emits a <label>+<div> structure
// that only lays out correctly with our flex CSS. CSS doesn't travel through
// the clipboard, so pasting into Notion/Google Docs/etc. breaks the layout.
//
// These overrides emit GFM-style task-list HTML (the de facto interop
// standard recognized by Notion, GitHub, Linear, Obsidian, etc.) for clipboard
// export, and accept GFM + generic checkbox-prefixed lists on paste.
//
// In-editor rendering is unchanged — TaskItem's NodeView still drives the
// viewport, and renderHTML is only used for clipboard export and getHTML().

export const PortableTaskList = TaskList.extend({
  renderHTML({ HTMLAttributes }) {
    return [
      "ul",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        "data-type": this.name,
        class: "contains-task-list",
      }),
      0,
    ]
  },
})

export const PortableTaskItem = TaskItem.extend({
  parseHTML() {
    return [
      { tag: `li[data-type="${this.name}"]`, priority: 51 },
      { tag: "li.task-list-item", priority: 50 },
      {
        tag: "li",
        priority: 50,
        getAttrs: (node) => {
          if (!(node instanceof HTMLElement)) return false
          const cb =
            node.querySelector(':scope > input[type="checkbox"]') ??
            node.querySelector(':scope > label > input[type="checkbox"]')
          if (!cb) return false
          return { checked: (cb as HTMLInputElement).checked }
        },
      },
    ]
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      "li",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        "data-type": this.name,
        "data-checked": node.attrs.checked ? "true" : "false",
        class: "task-list-item",
      }),
      [
        "input",
        {
          type: "checkbox",
          checked: node.attrs.checked ? "checked" : null,
          disabled: "disabled",
        },
      ],
      ["div", 0],
    ]
  },
})
