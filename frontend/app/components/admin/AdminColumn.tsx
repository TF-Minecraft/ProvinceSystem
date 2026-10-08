/** The column staff pages sit in, bar the map workspaces (MapWorkspace): centred, at the width of the title and tabs. */
export default function AdminColumn({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto flex w-full max-w-[72rem] flex-col">{children}</div>;
}
