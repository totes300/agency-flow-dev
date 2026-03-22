/**
 * ImageUploadNode extension — adapted from official TipTap UI Components.
 * Source: https://github.com/ueberdosis/tiptap-ui-components
 */
import { mergeAttributes, Node } from "@tiptap/react"
import { ReactNodeViewRenderer } from "@tiptap/react"
import { ImageUploadNodeComponent } from "@/components/tasks/image-upload-node/image-upload-node"
import type { NodeType } from "@tiptap/pm/model"

// ─── Pending files bridge ────────────────────────────────────────────────────
// Allows FileHandler.onDrop to pass files to a newly inserted ImageUploadNode.
// The node picks up files on mount via the initialFileId attribute, then clears them.
const pendingFilesMap = new Map<string, File[]>()

export function setPendingFiles(id: string, files: File[]) {
  pendingFilesMap.set(id, files)
}

export function consumePendingFiles(id: string): File[] | undefined {
  const files = pendingFilesMap.get(id)
  if (files) pendingFilesMap.delete(id)
  return files
}

export type UploadFunction = (
  file: File,
  onProgress?: (event: { progress: number }) => void,
  abortSignal?: AbortSignal
) => Promise<string>

export interface ImageUploadNodeOptions {
  type?: string | NodeType | undefined
  accept?: string
  limit?: number
  maxSize?: number
  upload?: UploadFunction
  onError?: (error: Error) => void
  onSuccess?: (url: string) => void
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  HTMLAttributes: Record<string, any>
}

declare module "@tiptap/react" {
  interface Commands<ReturnType> {
    imageUpload: {
      setImageUploadNode: (options?: Record<string, unknown>) => ReturnType
    }
  }
}

export const ImageUploadNode = Node.create<ImageUploadNodeOptions>({
  name: "imageUpload",

  group: "block",

  draggable: true,

  selectable: true,

  atom: true,

  addOptions() {
    return {
      type: "image",
      accept: "image/*",
      limit: 1,
      maxSize: 0,
      upload: undefined,
      onError: undefined,
      onSuccess: undefined,
      HTMLAttributes: {},
    }
  },

  addAttributes() {
    return {
      accept: { default: this.options.accept },
      limit: { default: this.options.limit },
      maxSize: { default: this.options.maxSize },
      initialFileId: { default: null, rendered: false },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="image-upload"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes({ "data-type": "image-upload" }, HTMLAttributes),
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(ImageUploadNodeComponent)
  },

  addCommands() {
    return {
      setImageUploadNode:
        (options) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: options,
          })
        },
    }
  },

  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const { selection } = editor.state
        const { nodeAfter } = selection.$from

        if (
          nodeAfter &&
          nodeAfter.type.name === "imageUpload" &&
          editor.isActive("imageUpload")
        ) {
          const nodeEl = editor.view.nodeDOM(selection.$from.pos)
          if (nodeEl && nodeEl instanceof HTMLElement) {
            const firstChild = nodeEl.firstChild
            if (firstChild && firstChild instanceof HTMLElement) {
              firstChild.click()
              return true
            }
          }
        }
        return false
      },
    }
  },
})

export default ImageUploadNode
