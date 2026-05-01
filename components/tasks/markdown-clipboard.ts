import { Extension } from "@tiptap/core"
import { Plugin, PluginKey } from "@tiptap/pm/state"
import { DOMSerializer } from "@tiptap/pm/model"
import type { Slice } from "@tiptap/pm/model"

// Notion and Google Docs largely ignore foreign HTML on paste; they read
// text/plain and run their own markdown-ish parser over it. So for outbound
// interop we emit GFM markdown as the plain-text clipboard payload via
// editor.markdown.serialize, and for inbound paste we detect markdown
// patterns (including Google Docs' ☐/☑ unicode chars) and parse them
// through editor.markdown.parse.
//
// Requires the @tiptap/markdown Markdown extension to be loaded (it adds
// editor.markdown).

const TASK_BULLET_RE = /^\s*[-*+]\s+\[[ xX]\]\s+/m

function containsTaskList(text: string): boolean {
  return TASK_BULLET_RE.test(text)
}

function normalizeUnicodeCheckboxes(text: string): string {
  // Google Docs and some other sources emit unicode checkbox glyphs instead
  // of GFM markers. Normalize them to GFM so the markdown parser handles them.
  // ☐ = unchecked, ☑/☒ = checked.
  return text
    .replace(/^(\s*)☐\s+/gm, "$1- [ ] ")
    .replace(/^(\s*)[☑☒]\s+/gm, "$1- [x] ")
}

export const MarkdownClipboard = Extension.create({
  name: "markdownClipboard",

  addProseMirrorPlugins() {
    const editor = this.editor

    // Build a clipboard HTML serializer that unwraps the <p> inside the first
    // child of every <li class="task-list-item">. Notion (and other editors)
    // expect GFM-style task list HTML where the text sits directly inside the
    // <li>, not wrapped in a <p>. Without this, Notion creates an empty to-do
    // block plus a separate child paragraph instead of a to-do whose text is
    // the task content.
    const baseSerializer = DOMSerializer.fromSchema(editor.schema)
    const taskListClipboardSerializer = new DOMSerializer(
      baseSerializer.nodes,
      baseSerializer.marks,
    )
    const originalSerializeFragment = taskListClipboardSerializer.serializeFragment.bind(
      taskListClipboardSerializer,
    )
    taskListClipboardSerializer.serializeFragment = (fragment, options, target) => {
      const dom = originalSerializeFragment(fragment, options, target)
      const root = dom as Element | DocumentFragment
      if (typeof (root as Element).querySelectorAll === "function") {
        root
          .querySelectorAll("li.task-list-item > p:first-child")
          .forEach((p) => {
            const parent = p.parentElement
            if (!parent) return
            while (p.firstChild) parent.insertBefore(p.firstChild, p)
            p.remove()
          })
      }
      return dom
    }

    return [
      new Plugin({
        key: new PluginKey("markdownClipboard"),
        props: {
          // Outbound HTML: schema's renderHTML produces <li><input><p>text</p></li>;
          // Notion treats the <p> as a child block. Strip the <p> wrapper so the
          // text is inline inside the <li>, matching GFM (GitHub, Linear, etc.).
          clipboardSerializer: taskListClipboardSerializer,

          // Outbound text: write GFM markdown into text/plain. Editors that
          // prefer plain text (Notion, Google Docs, Slack) parse this directly
          // into native to-do blocks.
          clipboardTextSerializer: (slice: Slice) => {
            const md = editor.storage.markdown
            if (!md || typeof editor.markdown?.serialize !== "function") {
              // Fallback: ProseMirror's default plain-text serializer.
              return slice.content.textBetween(0, slice.content.size, "\n\n")
            }
            try {
              return editor.markdown.serialize(slice.content.toJSON())
            } catch {
              return slice.content.textBetween(0, slice.content.size, "\n\n")
            }
          },

          // Inbound: when the user pastes from Notion / Google Docs / GitHub /
          // Slack / Linear, the text/plain payload is markdown-ish. Detect
          // task lists and other markdown structures, then parse through
          // editor.markdown.parse and insert.
          handlePaste(_view, event) {
            const rawText = event.clipboardData?.getData("text/plain")
            const rawHtml = event.clipboardData?.getData("text/html")
            // TEMP DEBUG — remove once paste interop is verified.
            // Inspect what the source app actually puts on the clipboard so we
            // can extend normalization rules if needed.
            console.log("[paste] text/plain:", JSON.stringify(rawText))
            console.log("[paste] text/html:", rawHtml)

            if (!rawText) return false

            const text = normalizeUnicodeCheckboxes(rawText)
            console.log("[paste] normalized:", JSON.stringify(text))
            console.log("[paste] containsTaskList:", containsTaskList(text))

            // Only intercept when the paste contains a task list (incl. the
            // unicode-checkbox flavor we just normalized). Plain prose, simple
            // bold, links, etc. fall through so the default paste pipeline can
            // use the richer text/html payload.
            if (!containsTaskList(text)) return false

            if (typeof editor.markdown?.parse !== "function") return false

            try {
              const json = editor.markdown.parse(text)
              if (!json) return false
              editor.commands.insertContent(json)
              return true
            } catch {
              return false
            }
          },
        },
      }),
    ]
  },
})
