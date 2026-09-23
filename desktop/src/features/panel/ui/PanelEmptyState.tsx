import { Radar } from "lucide-react";

/**
 * The panel read succeeded and the window holds no encargos. Not an error, and
 * not a failure of the read: the copy names the window the read actually
 * covered (the owner's most recent events, bounded per read) so "empty" cannot
 * be read as "the last session" and cannot be confused with a read that failed.
 */
export function PanelEmptyState() {
  return (
    <div
      className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border/60 px-4 py-12 text-center"
      data-testid="panel-empty-state"
    >
      <Radar aria-hidden="true" className="h-6 w-6 text-muted-foreground" />
      <p className="text-sm font-medium">No hay encargos en este periodo</p>
      <p className="max-w-md text-sm text-muted-foreground">
        Ventana consultada: los eventos más recientes del propietario, con un
        límite de 500 por lectura. La lista está vacía porque la fuente
        respondió y respondió que no hay encargos: no es un fallo de lectura.
      </p>
    </div>
  );
}
