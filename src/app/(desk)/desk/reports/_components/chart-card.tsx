import type { ReactNode } from "react";
import { Card, CardBody, CardHeader } from "@/components/ui";

/**
 * Card around a chart with a "Show as table" disclosure, so every number is
 * also readable without the graphic (screen readers, colour blindness, print).
 */
export function ChartCard({
  title,
  description,
  table,
  children,
  className,
}: {
  title: string;
  description?: ReactNode;
  table?: { columns: string[]; rows: (string | number)[][] };
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader title={title} description={description} />
      <CardBody>
        {children}
        {table && table.rows.length > 0 && (
          <details className="group mt-3 text-xs">
            <summary className="cursor-pointer select-none text-slate-500 hover:text-primary-700">
              <span className="group-open:hidden">Show as table</span>
              <span className="hidden group-open:inline">Hide table</span>
            </summary>
            <div className="mt-2 max-h-72 overflow-auto rounded-lg border border-slate-100 thin-scroll">
              <table className="w-full text-left">
                <caption className="sr-only">{title}</caption>
                <thead className="sticky top-0 bg-slate-50 text-slate-500">
                  <tr>
                    {table.columns.map((c, i) => (
                      <th key={c} scope="col" className={i === 0 ? "px-3 py-1.5 font-medium" : "px-3 py-1.5 text-right font-medium"}>
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {table.rows.map((r, i) => (
                    <tr key={i}>
                      {r.map((v, j) => (
                        <td key={j} className={j === 0 ? "px-3 py-1.5 text-slate-700" : "px-3 py-1.5 text-right tabular-nums text-slate-800"}>
                          {v}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        )}
      </CardBody>
    </Card>
  );
}
