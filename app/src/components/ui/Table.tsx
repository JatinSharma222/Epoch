"use client";

import React from "react";

export interface TableProps extends React.TableHTMLAttributes<HTMLTableElement> {
  dense?: boolean;
}

export const Table = React.forwardRef<HTMLTableElement, TableProps>(
  ({ className = "", dense = true, children, ...props }, ref) => (
    <div className="w-full overflow-auto font-sans select-none">
      <table
        ref={ref}
        className={`w-full caption-bottom text-xs text-left border-collapse ${className}`}
        {...props}
      >
        {children}
      </table>
    </div>
  )
);
Table.displayName = "Table";

export const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement> & { sticky?: boolean }
>(({ className = "", sticky = true, ...props }, ref) => (
  <thead
    ref={ref}
    className={`border-b border-line-default bg-surface-panel text-content-muted text-2xs font-semibold uppercase tracking-wider ${
      sticky ? "sticky top-0 z-10" : ""
    } ${className}`}
    {...props}
  />
));
TableHeader.displayName = "TableHeader";

export const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className = "", ...props }, ref) => (
  <tbody
    ref={ref}
    className={`divide-y divide-line-subtle text-content-secondary ${className}`}
    {...props}
  />
));
TableBody.displayName = "TableBody";

export const TableRow = React.forwardRef<
  HTMLTableRowElement,
  React.HTMLAttributes<HTMLTableRowElement> & { isSelected?: boolean }
>(({ className = "", isSelected = false, ...props }, ref) => (
  <tr
    ref={ref}
    className={`transition-colors hover:bg-surface-hover/70 ${
      isSelected ? "bg-surface-active/80" : ""
    } ${className}`}
    {...props}
  />
));
TableRow.displayName = "TableRow";

export const TableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement> & { alignRight?: boolean }
>(({ className = "", alignRight = false, ...props }, ref) => (
  <th
    ref={ref}
    className={`h-7 px-2.5 font-medium select-none ${
      alignRight ? "text-right" : "text-left"
    } ${className}`}
    {...props}
  />
));
TableHead.displayName = "TableHead";

export const TableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement> & {
    alignRight?: boolean;
    isMono?: boolean;
  }
>(({ className = "", alignRight = false, isMono = false, ...props }, ref) => (
  <td
    ref={ref}
    className={`px-2.5 py-1.5 align-middle ${
      alignRight ? "text-right" : "text-left"
    } ${isMono ? "font-mono tabular-nums" : ""} ${className}`}
    {...props}
  />
));
TableCell.displayName = "TableCell";
