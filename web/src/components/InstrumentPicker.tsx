"use client";
import { FAMILIES, INSTRUMENTS } from "@/lib/instruments";
import { InstrumentIcon } from "./InstrumentIcon";

export function InstrumentPicker({ value, onChange, columns = 3 }: { value: string; onChange: (id: string) => void; columns?: 2 | 3 | 4 }) {
  const grid = columns === 4 ? "grid-cols-2 sm:grid-cols-4" : columns === 2 ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-3";
  return (
    <div className="space-y-3">
      {FAMILIES.map((family) => (
        <div key={family}>
          <div className="label mb-2">{family}</div>
          <div className={`grid gap-2 ${grid}`}>
            {INSTRUMENTS.filter((i) => i.family === family).map((i) => {
              const selected = i.id === value;
              return (
                <button
                  key={i.id}
                  type="button"
                  onClick={() => onChange(i.id)}
                  aria-pressed={selected}
                  title={i.description}
                  className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left text-sm font-semibold transition ${
                    selected ? "border-accent bg-accent-soft" : "border-border bg-elev hover:bg-sunken"
                  }`}
                >
                  <span className={`shrink-0 ${selected ? "text-accent-strong" : "text-muted"}`}>
                    <InstrumentIcon icon={i.icon} />
                  </span>
                  <span className="truncate">{i.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
