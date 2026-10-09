import { Button } from "@/components/ui";

/** Floats at the bottom while a settings page has unsaved changes. */
export function UnsavedBar({ visible, saving, onSave, onDiscard }: { visible: boolean; saving: boolean; onSave: () => void; onDiscard: () => void }) {
  if (!visible) return null;
  return (
    <div className="animate-rise fixed bottom-5 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-xl border border-border bg-surface px-4 py-2.5 shadow-2xl">
      <span className="text-[13px]">You have unsaved changes</span>
      <Button size="sm" variant="ghost" onClick={onDiscard}>Discard</Button>
      <Button size="sm" variant="primary" loading={saving} onClick={onSave}>Save</Button>
    </div>
  );
}
