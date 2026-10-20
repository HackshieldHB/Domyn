"use client"

import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from "@tanstack/react-table"

export function DataTable<T>({ columns, data }: { columns: ColumnDef<T, unknown>[]; data: T[] }) {
  // TanStack Table returns functions the React compiler cannot memoize. That is expected.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({ data, columns, getCoreRowModel: getCoreRowModel() })
  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id}>
              {group.headers.map((header) => (
                <th key={header.id}>{header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}</th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id}>
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
