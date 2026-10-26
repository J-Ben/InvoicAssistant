import { useState } from 'react';
import type { ComponentEntry, EditRequest, InsertPosition, LayerNode, ProjectInfo } from '../shared/protocol.ts';
import type { Selection } from './App.tsx';
import { ColorInput, CommitInput } from './fields.tsx';
import { displayValue, toHex } from './values.ts';

interface Props {
  project: ProjectInfo;
  hidden: Set<string>;
  onToggleStory: (id: string) => void;
  activeStory: string | null;
  onActivateStory: (id: string) => void;
  tree: LayerNode[];
  selectedLoc: string | null;
  onSelectLayer: (loc: string) => void;
  onHoverLayer: (loc: string | null) => void;
  selection: Selection | null;
  onEdit: (request: EditRequest) => void;
}

type Tab = 'screens' | 'layers' | 'components' | 'theme';

/** Ce qu'on fait glisser : un calque existant ou un composant de la bibliothèque. */
type DragItem = { kind: 'layer'; loc: string; name: string } | { kind: 'component'; name: string; file: string | null };
const DRAG_TYPE = 'application/x-rn-canvas';
let dragging: DragItem | null = null;

const CONTAINERS = new Set(['View', 'ScrollView', 'SafeAreaView', 'KeyboardAvoidingView', 'Pressable', 'TouchableOpacity', 'TouchableHighlight']);
const fileOf = (loc: string) => loc.split(':')[0];

export function Sidebar(props: Props) {
  const [tab, setTab] = useState<Tab>('screens');
  return (
    <aside className="sidebar left">
      <nav className="tabs">
        <button className={tab === 'screens' ? 'on' : ''} onClick={() => setTab('screens')}>Écrans</button>
        <button className={tab === 'layers' ? 'on' : ''} onClick={() => setTab('layers')}>Calques</button>
        <button className={tab === 'components' ? 'on' : ''} onClick={() => setTab('components')}>Composants</button>
        <button className={tab === 'theme' ? 'on' : ''} onClick={() => setTab('theme')}>Thème</button>
      </nav>
      <div className="panel-body">
        {tab === 'screens' && <Screens {...props} />}
        {tab === 'layers' && <Layers {...props} />}
        {tab === 'components' && <Components {...props} />}
        {tab === 'theme' && <Theme {...props} />}
      </div>
    </aside>
  );
}

function Screens({ project, hidden, onToggleStory, activeStory, onActivateStory }: Props) {
  if (project.stories.length === 0) return <p className="hint">Aucun fichier *.canvas.tsx trouvé.</p>;
  return (
    <>
      {project.stories.map((group) => (
        <div key={group.file} className="group">
          <div className="group-title" title={group.file}>{group.title}</div>
          {group.stories.map((story) => (
            <div key={story.id} className={`row ${activeStory === story.id ? 'selected' : ''}`}>
              <input type="checkbox" checked={!hidden.has(story.id)} onChange={() => onToggleStory(story.id)} aria-label={`Afficher ${story.title}`} />
              <button className="row-label" onClick={() => onActivateStory(story.id)}>{story.title}</button>
            </div>
          ))}
        </div>
      ))}
    </>
  );
}

function Layers({ tree, activeStory, selectedLoc, onSelectLayer, onHoverLayer, onEdit }: Props) {
  if (!activeStory) return <p className="hint">Cliquez sur un écran pour voir ses calques.</p>;
  if (tree.length === 0) return <p className="hint">Chargement des calques…</p>;

  const drop = (target: LayerNode, position: InsertPosition) => {
    const item = dragging;
    dragging = null;
    if (!item) return;
    if (item.kind === 'layer') {
      if (item.loc === target.loc) return;
      onEdit({ op: 'move', loc: item.loc, name: item.name, target: target.loc, targetName: target.name, position });
    } else {
      onEdit({ op: 'insert', loc: target.loc, name: target.name, position, component: { name: item.name, file: item.file } });
    }
  };

  return (
    <>
      <p className="hint small">Glissez un calque pour le déplacer (même fichier), ou un composant depuis l'onglet Composants.</p>
      <ul className="layers" onMouseLeave={() => onHoverLayer(null)}>
        {tree.map((node) => (
          <Layer key={node.key} node={node} depth={0} selectedLoc={selectedLoc} onSelect={onSelectLayer} onHover={onHoverLayer} onDrop={drop} />
        ))}
      </ul>
    </>
  );
}

interface LayerProps {
  node: LayerNode;
  depth: number;
  selectedLoc: string | null;
  onSelect: (loc: string) => void;
  onHover: (loc: string | null) => void;
  onDrop: (target: LayerNode, position: InsertPosition) => void;
}

function Layer({ node, depth, selectedLoc, onSelect, onHover, onDrop }: LayerProps) {
  const [open, setOpen] = useState(depth < 3);
  const [indicator, setIndicator] = useState<InsertPosition | 'invalid' | null>(null);
  const file = fileOf(node.loc).split('/').pop();
  const isComponent = /^[A-Z]/.test(node.name) && !BUILTINS.has(node.name);

  const positionAt = (e: React.DragEvent): InsertPosition | 'invalid' => {
    if (dragging?.kind === 'layer' && fileOf(dragging.loc) !== fileOf(node.loc)) return 'invalid';
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const y = (e.clientY - rect.top) / rect.height;
    if (y < 0.3) return 'before';
    if (y > 0.7 && !(open && node.children.length)) return 'after';
    return 'inside';
  };

  return (
    <li>
      <div
        className={`layer ${selectedLoc === node.loc ? 'selected' : ''} ${indicator ? `drop-${indicator}` : ''}`}
        style={{ paddingLeft: 8 + depth * 12 }}
        draggable
        onDragStart={(e) => {
          dragging = { kind: 'layer', loc: node.loc, name: node.name };
          e.dataTransfer.setData(DRAG_TYPE, node.loc);
          e.dataTransfer.effectAllowed = 'move';
        }}
        onDragEnd={() => (dragging = null)}
        onDragOver={(e) => {
          if (!dragging) return;
          const position = positionAt(e);
          setIndicator(position);
          if (position !== 'invalid') {
            e.preventDefault();
            e.dataTransfer.dropEffect = dragging.kind === 'layer' ? 'move' : 'copy';
          }
        }}
        onDragLeave={() => setIndicator(null)}
        onDrop={(e) => {
          e.preventDefault();
          const position = positionAt(e);
          setIndicator(null);
          if (position !== 'invalid') onDrop(node, position);
        }}
        onMouseEnter={() => onHover(node.loc)}
        onClick={() => onSelect(node.loc)}
        title={node.loc}
      >
        <button className="twisty" onClick={(e) => (e.stopPropagation(), setOpen(!open))} style={{ visibility: node.children.length ? 'visible' : 'hidden' }}>
          {open ? '▾' : '▸'}
        </button>
        <span className={isComponent ? 'component' : ''}>{isComponent ? '◇ ' : ''}{node.name}</span>
        <span className="muted small">{file}</span>
      </div>
      {open && node.children.length > 0 && (
        <ul>
          {node.children.map((child) => (
            <Layer key={child.key} node={child} depth={depth + 1} selectedLoc={selectedLoc} onSelect={onSelect} onHover={onHover} onDrop={onDrop} />
          ))}
        </ul>
      )}
    </li>
  );
}

function Components({ project, selection, onEdit }: Props) {
  const [query, setQuery] = useState('');
  const groups = new Map<string, ComponentEntry[]>();
  for (const c of project.components) {
    if (query && !c.name.toLowerCase().includes(query.toLowerCase())) continue;
    groups.set(c.group, [...(groups.get(c.group) ?? []), c]);
  }

  const insert = (c: ComponentEntry) => {
    if (!selection) return;
    const { loc, name } = selection.info;
    // Dans un conteneur : à la fin de ses enfants ; sinon juste après l'élément sélectionné.
    const position: InsertPosition = CONTAINERS.has(name) ? 'inside' : 'after';
    onEdit({ op: 'insert', loc, name, position, component: { name: c.name, file: c.file } });
  };

  return (
    <>
      <input className="search" placeholder="Rechercher un composant" value={query} onChange={(e) => setQuery(e.target.value)} />
      <p className="hint small">
        {selection
          ? `Cliquez pour insérer ${CONTAINERS.has(selection.info.name) ? 'dans' : 'après'} <${selection.info.name}>, ou glissez vers les calques.`
          : 'Sélectionnez un élément, ou glissez un composant vers les calques.'}
      </p>
      {[...groups].map(([group, items]) => (
        <div key={group} className="group">
          <div className="group-title">{group}</div>
          {items.map((c) => (
            <button
              key={`${c.file}:${c.name}`}
              className="component-item"
              draggable
              aria-disabled={!selection}
              onDragStart={(e) => {
                dragging = { kind: 'component', name: c.name, file: c.file };
                e.dataTransfer.setData(DRAG_TYPE, c.name);
                e.dataTransfer.effectAllowed = 'copy';
              }}
              onDragEnd={() => (dragging = null)}
              onClick={() => insert(c)}
              title={c.file ?? 'react-native'}
            >
              <span className={c.file ? 'component' : ''}>{c.file ? '◇ ' : ''}{c.name}</span>
              {c.props.length > 0 && <span className="muted small">{c.props.map((p) => p.name).join(', ')}</span>}
            </button>
          ))}
        </div>
      ))}
    </>
  );
}

const BUILTINS = new Set(['View', 'Text', 'Image', 'ScrollView', 'FlatList', 'SectionList', 'TextInput', 'Pressable', 'TouchableOpacity', 'TouchableHighlight', 'TouchableWithoutFeedback', 'SafeAreaView', 'KeyboardAvoidingView', 'ActivityIndicator', 'Switch', 'Modal', 'ImageBackground']);

function Theme({ project, onEdit }: Props) {
  const theme = project.theme;
  if (!theme) {
    return (
      <p className="hint">
        Aucun thème configuré. Ajoutez dans <code>rn-canvas.json</code> :<br />
        <code>{'"theme": { "file": "src/theme/colors.ts", "export": "colors" }'}</code>
      </p>
    );
  }
  return (
    <>
      <p className="hint small">
        {theme.file} — une modification s'applique à toute l'app.
      </p>
      {theme.tokens.map((token) => {
        const text = displayValue(token.value);
        const hex = toHex(text);
        const editable = token.value.kind !== 'expression';
        return (
          <div key={token.path} className="token">
            <span className="token-name">{token.path.split('.').slice(1).join('.')}</span>
            {hex ? (
              <ColorInput value={hex} disabled={!editable} onCommit={(v) => onEdit({ op: 'setToken', path: token.path, value: { kind: 'literal', value: v } })} />
            ) : null}
            <CommitInput
              value={text}
              disabled={!editable}
              onCommit={(v) =>
                onEdit({ op: 'setToken', path: token.path, value: { kind: 'literal', value: /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v } })
              }
            />
          </div>
        );
      })}
    </>
  );
}
