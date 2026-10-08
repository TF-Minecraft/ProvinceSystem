/** The column every staff page sits in: centred, at the same width as the title and tabs. */
export default function AdminColumn({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto flex w-full max-w-[72rem] flex-col">{children}</div>;
}
