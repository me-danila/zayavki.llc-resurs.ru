import * as React from "react"
import { ChevronsUpDown, Plus } from "lucide-react"
import { Command } from "cmdk"
import * as Popover from "@radix-ui/react-popover"
import { cn } from "../../lib/utils"
import Fuse from "fuse.js"

interface ComboboxProps {
  options: string[]
  value: string
  onChange: (value: string) => void
  placeholder?: string
  emptyMessage?: string
  allowCustom?: boolean
}

export function Combobox({
  options,
  value,
  onChange,
  placeholder = "Выберите...",
  emptyMessage = "Ничего не найдено.",
  allowCustom = true,
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false)
  const [search, setSearch] = React.useState("")

  const fuse = React.useMemo(() => new Fuse(options, {
    threshold: 0.3,
    distance: 100,
  }), [options])

  const filteredOptions = React.useMemo(() => {
    if (!search) return options.slice(0, 50)
    const results = fuse.search(search).map(r => r.item)
    return results.slice(0, 50)
  }, [search, fuse, options])

  const handleOpenChange = (newOpen: boolean) => {
    if (newOpen && !open) {
      setSearch(value || "")
    }
    setOpen(newOpen)
  }

  const handleSelect = (selectedValue: string) => {
    onChange(selectedValue)
    setOpen(false)
  }

  return (
    <Popover.Root open={open} onOpenChange={handleOpenChange}>
      <Popover.Anchor asChild>
        <div className="relative w-full">
          <input
            type="text"
            className="flex h-10 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm ring-offset-white placeholder:text-gray-500 focus:outline-none focus:border-primary-resource focus:ring-2 focus:ring-primary-resource/20 disabled:cursor-not-allowed disabled:opacity-50 pr-8 transition-all"
            placeholder={placeholder}
            value={open ? search : (value || "")}
            onChange={(e) => {
              setSearch(e.target.value)
              if (!open) setOpen(true)
              if (allowCustom) {
                onChange(e.target.value)
              }
            }}
            onFocus={() => {
              if (!open) handleOpenChange(true)
            }}
            onClick={() => {
              if (!open) handleOpenChange(true)
            }}
          />
          <ChevronsUpDown className="absolute right-2 top-3 h-4 w-4 shrink-0 opacity-50 pointer-events-none" />
        </div>
      </Popover.Anchor>
      <Popover.Content
        className="z-50 w-[var(--radix-popover-trigger-width)] min-w-[200px] overflow-hidden rounded-md border bg-white p-0 shadow-md animate-in fade-in-0 zoom-in-95"
        align="start"
        onOpenAutoFocus={(e) => e.preventDefault()} // Don't focus the first item automatically to allow typing
      >
        <Command shouldFilter={false} className="flex h-full w-full flex-col overflow-hidden bg-white">
          <Command.List className="max-h-[300px] overflow-y-auto overflow-x-hidden p-1">
            {filteredOptions.length === 0 && !allowCustom && (
              <div className="py-6 text-center text-sm">{emptyMessage}</div>
            )}
            {filteredOptions.map((option) => (
              <Command.Item
                key={option}
                value={option}
                onSelect={() => handleSelect(option)}
                className={cn(
                  "relative flex cursor-pointer select-none items-center rounded-sm px-2 py-2 text-sm outline-none hover:bg-gray-100 data-[selected='true']:bg-gray-100",
                  value === option && "bg-gray-50"
                )}
              >
                {option}
              </Command.Item>
            ))}
            {allowCustom && search && !options.includes(search) && (
              <Command.Item
                value={search}
                onSelect={() => handleSelect(search)}
                className="relative flex cursor-pointer select-none items-center rounded-sm px-2 py-2 text-sm outline-none hover:bg-gray-100 data-[selected='true']:bg-gray-100 text-blue-600 font-medium border-t mt-1"
              >
                <Plus className="mr-2 h-4 w-4" />
                Добавить "{search}"
              </Command.Item>
            )}
          </Command.List>
        </Command>
      </Popover.Content>
    </Popover.Root>
  )
}
