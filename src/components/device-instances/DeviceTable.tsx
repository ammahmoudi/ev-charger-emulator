import type { ReactNode } from "react";

/**
 * Grid table in the reference style: bold-ish header cells separated by faint vertical rules, zebra-free
 * rows ruled by hairlines, and blank rows padding the table to a fixed height like the real screen.
 */
export function DeviceTable({ columns, rows, minRows = 5 }: { columns: { label: ReactNode; width: string; align?: "left" | "center" }[]; rows: ReactNode[][]; minRows?: number }) {
  const grid = { gridTemplateColumns: columns.map((c) => c.width).join(" ") } as const;
  const blanks = Math.max(0, minRows - rows.length);
  return (
    <div className="mx-[8px] flex-none border-t border-[#e3e6ea] text-[#333]">
      <div className="grid" style={grid}>
        {columns.map((c, i) => (
          <div key={i} className="flex min-h-[60px] items-center justify-center border-r border-[#e3e6ea] px-[6px] text-center text-[24px] leading-[26px] text-[#555] last:border-r-0">
            {c.label}
          </div>
        ))}
      </div>
      {rows.map((cells, r) => (
        <div key={r} className="grid border-t border-[#e3e6ea]" style={grid}>
          {cells.map((cell, i) => (
            <div key={i} className={`flex min-h-[56px] items-center border-r border-[#e3e6ea] px-[10px] text-[26px] last:border-r-0 ${columns[i].align === "left" ? "justify-start" : "justify-center"} text-center`}>
              {cell}
            </div>
          ))}
        </div>
      ))}
      {Array.from({ length: blanks }).map((_, r) => (
        <div key={`b${r}`} className="grid border-t border-[#e3e6ea]" style={grid}>
          {columns.map((_c, i) => (
            <div key={i} className="min-h-[56px] border-r border-[#e3e6ea] last:border-r-0" />
          ))}
        </div>
      ))}
    </div>
  );
}
