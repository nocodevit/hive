import { forwardRef, useImperativeHandle, useRef } from 'react'
import { keyToBytes } from '../../lib/keyboard'

export interface HelperTextareaHandle {
  focus: () => void
}

interface Props {
  /** Viewport-relative pixel x for positioning the invisible textarea (so
   * the macOS IME candidate window pops at the cursor). */
  left: number
  top: number
  /** Character cell metrics — textarea sized to one cell. */
  width: number
  height: number
  onKeyBytes: (bytes: string) => void
  onTextInput: (text: string) => void
  onFocus: () => void
  onBlur: () => void
  /** Copy-on-Cmd+C requires knowing if there is a selection to handle. */
  onCopyAttempt: () => boolean
}

/**
 * Invisible helper textarea for keyboard + IME capture. Mirrors xterm.js's
 * `xterm-helper-textarea` pattern — macOS's IME candidate window positions
 * itself relative to the focused input element, so we anchor this textarea
 * at the cursor cell.
 *
 * Printable characters fall through to `onInput` (so IME composition works
 * naturally); special keys (arrows, Enter, Ctrl+X, Tab, …) are captured in
 * `onKeyDown` and routed through `keyToBytes`.
 */
export const HelperTextarea = forwardRef<HelperTextareaHandle, Props>(
  function HelperTextarea(
    { left, top, width, height, onKeyBytes, onTextInput, onFocus, onBlur, onCopyAttempt },
    ref
  ) {
    const innerRef = useRef<HTMLTextAreaElement>(null)
    const composing = useRef(false)

    useImperativeHandle(ref, () => ({ focus: () => innerRef.current?.focus() }), [])

    return (
      <textarea
        ref={innerRef}
        onFocus={onFocus}
        onBlur={onBlur}
        onKeyDown={e => {
          if (composing.current) return
          const k = e.key
          const ctrl = e.ctrlKey || e.metaKey
          if (k.length === 1 && !ctrl) return // let onInput handle printables
          if (ctrl && k.toLowerCase() === 'c' && onCopyAttempt()) {
            e.preventDefault()
            return
          }
          const bytes = keyToBytes(e.nativeEvent)
          if (bytes != null) {
            e.preventDefault()
            onKeyBytes(bytes)
          }
        }}
        onInput={e => {
          if (composing.current) return
          const el = e.currentTarget
          if (el.value) onTextInput(el.value)
          el.value = ''
        }}
        onCompositionStart={() => { composing.current = true }}
        onCompositionEnd={e => {
          composing.current = false
          const el = e.currentTarget
          if (el.value) onTextInput(el.value)
          el.value = ''
        }}
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete="off"
        spellCheck={false}
        style={{
          position: 'absolute',
          left,
          top,
          width,
          height,
          opacity: 0,
          background: 'transparent',
          color: 'transparent',
          caretColor: 'transparent',
          border: 'none',
          outline: 'none',
          resize: 'none',
          padding: 0,
          margin: 0,
          overflow: 'hidden',
          zIndex: 20,
          pointerEvents: 'none'
        }}
      />
    )
  }
)
