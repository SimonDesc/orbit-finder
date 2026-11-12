import { ArrowRight, LoaderCircle, Sparkles } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

const EXAMPLES = [
  'Which fields around Toulouse were flooded after last week’s storm?',
  'Ships waiting at anchor within 15 km of Fos-sur-Mer',
  'Détecter les départs de feu dans le massif des Maures',
  'Nouvelles constructions autour de Blagnac depuis septembre',
]

interface Props {
  loading: boolean
  onSubmit: (text: string) => void
}

export function SearchBar({ loading, onSubmit }: Props) {
  const [text, setText] = useState('')

  const submit = (value: string) => {
    const v = value.trim()
    if (v.length >= 3 && !loading) onSubmit(v)
  }

  return (
    <div className="space-y-2.5">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          submit(text)
        }}
      >
        <div className="relative flex-1">
          <Sparkles className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-sky-300" />
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="What do you need to know, and where?"
            aria-label="Describe your need"
            maxLength={500}
            className="h-9 pl-8"
          />
        </div>
        <Button type="submit" size="lg" disabled={loading || text.trim().length < 3}>
          {loading ? <LoaderCircle className="animate-spin" /> : <ArrowRight />}
          <span className="sr-only">Ask</span>
        </Button>
      </form>
      <div className="flex flex-wrap gap-1.5">
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            disabled={loading}
            onClick={() => {
              setText(ex)
              submit(ex)
            }}
            className="rounded-full border border-border px-2.5 py-1 text-left text-xs text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground disabled:opacity-50"
          >
            {ex}
          </button>
        ))}
      </div>
    </div>
  )
}
