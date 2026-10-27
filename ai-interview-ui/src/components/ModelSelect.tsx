// Searchable dropdown of the models a provider key can use. Recommended models
// are listed first; long lists (OpenRouter has hundreds) get a search box.
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { Check, ChevronDown, Search, Sparkles } from 'lucide-react'

export interface SelectOption {
  id: string
  name: string
  detail: string
  recommended?: boolean
}

const SEARCH_THRESHOLD = 8

export function ModelSelect({ options, value, onChange, disabled, placeholder, label }: {
  options: SelectOption[]
  value: string | null
  onChange: (id: string) => void
  disabled?: boolean
  placeholder: string
  label: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const root = useRef<HTMLDivElement>(null)
  const listId = useId()

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const q = query.trim().toLowerCase()
  const shown = q ? options.filter(o => `${o.name} ${o.id}`.toLowerCase().includes(q)) : options
  const selected = options.find(o => o.id === value)

  function toggle() {
    if (disabled) return
    setQuery('')
    setActive(Math.max(0, options.findIndex(o => o.id === value)))
    setOpen(o => !o)
  }

  function choose(o: SelectOption) {
    onChange(o.id)
    setOpen(false)
  }

  function onKey(e: KeyboardEvent) {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle() }
      return
    }
    if (e.key === 'Escape') { e.preventDefault(); setOpen(false) }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => Math.min(i + 1, shown.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(i - 1, 0)) }
    else if (e.key === 'Enter' && shown[active]) { e.preventDefault(); choose(shown[active]) }
  }

  return (
    <div ref={root} className="relative" onKeyDown={onKey}>
      <button
        type="button"
        onClick={toggle}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={label}
        className="w-full flex items-center gap-2 text-left bg-input/60 border border-border rounded-xl px-3.5 py-2.5 text-sm hover:border-primary/40 focus:outline-none focus:border-primary/60 focus:ring-4 focus:ring-primary/15 transition disabled:opacity-60 disabled:cursor-not-allowed"
      >
        <span className="flex-1 min-w-0">
          {selected ? (
            <span className="flex items-center gap-2 min-w-0">
              <span className="truncate">{selected.name}</span>
              {selected.recommended && <Sparkles className="w-3.5 h-3.5 text-primary shrink-0" />}
              {selected.detail && <span className="text-xs text-muted-foreground truncate hidden sm:inline">{selected.detail}</span>}
            </span>
          ) : (
            <span className="text-muted-foreground">{placeholder}</span>
          )}
        </span>
        <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute z-30 mt-2 w-full rounded-xl border border-border bg-surface shadow-2xl shadow-black/40 overflow-hidden">
          {options.length > SEARCH_THRESHOLD && (
            <div className="flex items-center gap-2 px-3 border-b border-border">
              <Search className="w-4 h-4 text-muted-foreground shrink-0" />
              <input
                autoFocus
                value={query}
                onChange={e => { setQuery(e.target.value); setActive(0) }}
                placeholder={`Search ${options.length} models…`}
                aria-label="Search models"
                className="w-full bg-transparent py-2.5 text-sm placeholder:text-muted-foreground/60 focus:outline-none"
              />
            </div>
          )}
          <ul id={listId} role="listbox" aria-label={label} className="max-h-72 overflow-y-auto py-1">
            {shown.length === 0 && <li className="px-3.5 py-3 text-sm text-muted-foreground">No models match “{query}”.</li>}
            {shown.map((o, i) => {
              const firstOther = i > 0 && !o.recommended && shown[i - 1].recommended
              return (
                <li key={o.id}>
                  {i === 0 && o.recommended && !q && <div className="px-3.5 pt-2 pb-1 text-[10px] uppercase tracking-wider text-primary font-semibold">Recommended</div>}
                  {firstOther && !q && <div className="px-3.5 pt-3 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold border-t border-border mt-1">All models</div>}
                  <button
                    type="button"
                    role="option"
                    aria-selected={o.id === value}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => choose(o)}
                    className={`w-full flex items-center gap-2 px-3.5 py-2 text-left text-sm transition ${i === active ? 'bg-primary/10' : ''}`}
                  >
                    <span className="flex-1 min-w-0">
                      <span className="block truncate">{o.name}</span>
                      {(o.name !== o.id || o.detail) && (
                        <span className="block text-[11px] text-muted-foreground truncate">
                          {o.name !== o.id && <span className="font-mono">{o.id}</span>}
                          {o.name !== o.id && o.detail && ' · '}
                          {o.detail}
                        </span>
                      )}
                    </span>
                    {o.id === value && <Check className="w-4 h-4 text-primary shrink-0" />}
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}
