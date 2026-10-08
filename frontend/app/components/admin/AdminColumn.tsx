/** The reading column for staff pages without a map: one width, on the frame's left edge. */
export default function AdminColumn({ children }: { children: React.ReactNode }) {
  return <div className="flex max-w-5xl flex-col">{children}</div>;
}
