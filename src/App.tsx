import { useState, useCallback, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import {
  Tldraw,
  useEditor,
  DefaultToolbar,
  DefaultToolbarContent,
} from 'tldraw'
import type { TLComponents } from 'tldraw'
import 'tldraw/tldraw.css'


const SVG_ITEMS = [
  { name: 'Estrella', file: '/svgs/star.svg', emoji: '⭐' },
  { name: 'Cohete', file: '/svgs/rocket.svg', emoji: '🚀' },
  { name: 'Corazón', file: '/svgs/heart.svg', emoji: '❤️' },
]


function SvgToolbarButton() {
  const editor = useEditor()
  const [open, setOpen] = useState(false)
  const [previews, setPreviews] = useState<Record<string, string>>({})
  const [popupPos, setPopupPos] = useState({ x: 0, y: 0 })
  const popoverRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    SVG_ITEMS.forEach(async (item) => {
      try {
        const res = await fetch(item.file)
        const text = await res.text()
        setPreviews((prev) => ({ ...prev, [item.file]: text }))
      } catch {
        // ignore
      }
    })
  }, [])

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const handleToggle = useCallback(() => {
    if (!open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect()
      setPopupPos({
        x: rect.left + rect.width / 2,
        y: rect.top - 12,
      })
    }
    setOpen(!open)
  }, [open])

  const addSvg = useCallback(
    async (file: string) => {
      const res = await fetch(file)
      const text = await res.text()

      const encoded = btoa(unescape(encodeURIComponent(text)))
      const dataUri = `data:image/svg+xml;base64,${encoded}`

      
      const parser = new DOMParser()
      const doc = parser.parseFromString(text, 'image/svg+xml')
      const svgEl = doc.querySelector('svg')
      let w = 200
      let h = 200
      if (svgEl) {
        const vb = svgEl.getAttribute('viewBox')
        if (vb) {
          const parts = vb.split(/[\s,]+/).map(Number)
          if (parts.length === 4) {
            w = parts[2]
            h = parts[3]
          }
        }
        if (svgEl.hasAttribute('width'))
          w = parseFloat(svgEl.getAttribute('width')!) || w
        if (svgEl.hasAttribute('height'))
          h = parseFloat(svgEl.getAttribute('height')!) || h
      }

      const { x, y } = editor.getViewportScreenCenter()
      const point = editor.screenToPage({ x, y })

      const assetId = `asset:svg-${Date.now()}` as any
      editor.createAssets([
        {
          id: assetId,
          type: 'image',
          typeName: 'asset',
          props: {
            name: file.split('/').pop() || 'svg',
            src: dataUri,
            w,
            h,
            mimeType: 'image/svg+xml',
            isAnimated: false,
          },
          meta: {},
        },
      ])

      editor.createShape({
        type: 'image',
        x: point.x - w / 2,
        y: point.y - h / 2,
        props: { assetId, w, h },
      })

      setOpen(false)
    },
    [editor],
  )

  return (
    <>
      <button
        ref={buttonRef}
        onClick={handleToggle}
        title="Agregar SVG"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 40,
          height: 40,
          borderRadius: '8px',
          border: 'none',
          background: open ? 'rgba(0,0,0,0.08)' : 'transparent',
          cursor: 'pointer',
          padding: 0,
          color: '#1d1d1d',
          transition: 'background 0.1s',
        }}
        onMouseEnter={(e) => {
          if (!open) e.currentTarget.style.background = 'rgba(0,0,0,0.05)'
        }}
        onMouseLeave={(e) => {
          if (!open) e.currentTarget.style.background = 'transparent'
        }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
          <line x1="12" y1="8" x2="12" y2="16" />
          <line x1="8" y1="12" x2="16" y2="12" />
        </svg>
      </button>

      {open &&
        createPortal(
          <div
            ref={popoverRef}
            style={{
              position: 'fixed',
              bottom: `${window.innerHeight - popupPos.y}px`,
              left: `${popupPos.x}px`,
              transform: 'translateX(-50%)',
              background: 'white',
              borderRadius: '12px',
              boxShadow:
                '0 4px 24px rgba(0,0,0,0.15), 0 0 0 1px rgba(0,0,0,0.06)',
              padding: '8px',
              display: 'flex',
              gap: '6px',
              zIndex: 99999,
              animation: 'svgPopIn 0.15s ease-out',
            }}
          >
            {SVG_ITEMS.map((item) => (
              <button
                key={item.file}
                onClick={() => addSvg(item.file)}
                title={item.name}
                style={{
                  width: 72,
                  height: 72,
                  borderRadius: '10px',
                  border: '2px solid transparent',
                  background: '#f9fafb',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '4px',
                  padding: '4px',
                  transition: 'all 0.12s ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = '#6366f1'
                  e.currentTarget.style.background = '#eef2ff'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'transparent'
                  e.currentTarget.style.background = '#f9fafb'
                }}
              >
                <div
                  style={{
                    width: 40,
                    height: 40,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                  dangerouslySetInnerHTML={{
                    __html: previews[item.file]
                      ? previews[item.file]
                          .replace(/width="[^"]*"/, 'width="36"')
                          .replace(/height="[^"]*"/, 'height="36"')
                      : `<span style="font-size:24px">${item.emoji}</span>`,
                  }}
                />
                <span
                  style={{
                    fontSize: '9px',
                    fontWeight: 600,
                    color: '#6b7280',
                    fontFamily: "'Inter', system-ui, sans-serif",
                  }}
                >
                  {item.name}
                </span>
              </button>
            ))}
          </div>,
          document.body,
        )}

      <style>{`
        @keyframes svgPopIn {
          from { opacity: 0; transform: translateX(-50%) translateY(4px) scale(0.95); }
          to { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); }
        }
      `}</style>
    </>
  )
}


function CustomToolbar() {
  return (
    <DefaultToolbar>
      <DefaultToolbarContent />
      <SvgToolbarButton />
    </DefaultToolbar>
  )
}

const components: TLComponents = {
  Toolbar: CustomToolbar,
}


export default function App() {
  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <Tldraw
        persistenceKey="tldraw-custom"
        components={components}
        licenseKey={import.meta.env.VITE_TLDRAW_LICENSE_KEY}
      />
    </div>
  )
}
