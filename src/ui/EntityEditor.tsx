import { useState } from 'preact/hooks';
import type { Entity, EntityKind } from '../types';
import { normalizeKey } from '../parser';

interface Props {
  kind: EntityKind;
  entity: Entity; // la que se edita
  entities: Entity[]; // todas las de su tipo: si el nuevo nombre cae en otra, se fusiona
  pending: Map<string, number>; // '#clave' | '@clave' -> tareas pendientes
  variant: 'inline' | 'sheet'; // inline: escritorio, en su sitio · sheet: hoja inferior en móvil
  onSave: (name: string) => void;
  onCancel: () => void;
  onDelete?: () => void; // solo en la hoja
}

// Las etiquetas no admiten espacios (ver parseLine).
const VALID = /^[\p{L}\p{N}_-]+$/u;

/** Editor de un tema o persona: nombre sin símbolo y aviso si el nuevo nombre fusiona con otra. */
export function EntityEditor({ kind, entity, entities, pending, variant, onSave, onCancel, onDelete }: Props) {
  const sym = kind === 'topic' ? '#' : '@';
  const [name, setName] = useState(entity.name);
  const clean = name.replace(/^[\s#@]+/, '').trim();
  const key = normalizeKey(clean);
  const target = key && key !== entity.key ? entities.find((e) => e.key === key) : undefined;
  const n = target ? pending.get(sym + target.key) ?? 0 : 0;
  const invalid = clean !== '' && !VALID.test(clean);
  const valid = clean !== '' && !invalid && clean !== entity.name;
  const hint = invalid ? 'Sin espacios: usa letras, números, _ o -'
    : target ? `Se unirá con ${sym}${target.name} (${n} ${n === 1 ? 'tarea' : 'tareas'})`
    : '';

  const save = () => { if (valid) onSave(clean); };
  const onEnter = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); save(); }
  };
  // Esc cancela; se corta la propagación para que no cierre también Ajustes ni limpie el filtro.
  const onEsc = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); onCancel(); }
  };

  const input = (
    <input autoFocus value={name} aria-label={kind === 'topic' ? 'Nombre del tema' : 'Nombre de la persona'}
      autocomplete="off" autocapitalize="off" spellcheck={false}
      onInput={(e) => setName(e.currentTarget.value)} onKeyDown={onEnter}
      onBlur={variant === 'inline' ? onCancel : undefined} />
  );

  if (variant === 'inline') {
    return (
      <div class="ent-inline" onKeyDown={onEsc}>
        <span class="ent-sym">{sym}</span>
        {input}
        {hint && <small class="ent-hint">{hint}</small>}
      </div>
    );
  }

  return (
    <div class="ent-back" onClick={onCancel}>
      <div class="ent-sheet" role="dialog" aria-modal="true" aria-label={kind === 'topic' ? 'Editar tema' : 'Editar persona'}
        onClick={(e) => e.stopPropagation()} onKeyDown={onEsc}>
        <span class="label">{kind === 'topic' ? 'Tema' : 'Persona'}</span>
        <div class="ent-field">
          <span class="ent-sym">{sym}</span>
          {input}
        </div>
        {hint && <p class="ent-hint">{hint}</p>}
        <div class="ent-actions">
          <button class="btn solid" disabled={!valid} onClick={save}>{target ? 'Unir' : 'Guardar'}</button>
          {onDelete && <button class="link danger" onClick={onDelete}>Borrar</button>}
          <button class="link" onClick={onCancel}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}
