import { useState } from 'react';
import type { EditRequest, LayerNode, ProjectInfo } from '../shared/protocol.ts';
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
  onEdit: (request: EditRequest) => void;
}

type Tab = 'screens' | 'layers' | 'theme';

export function Sidebar(props: Props) {
  const [tab, setTab] = useState<Tab>('screens');
  return (
    <aside className="sidebar left">
      <nav className="tabs">
        <button className={tab === 'screens' ? 'on' : ''} onClick={() => setTab('screens')}>Écrans</button>
        <button className={tab === 'layers' ? 'on' : ''} onClick={() => setTab('layers')}>Calques</button>
        <button className={tab === 'theme' ? 'on' : ''} onClick={() => setTab('theme')}>Thème</button>
      </nav>
      <div className="panel-body">
        {tab === 'screens' && <Screens {...props} />}
        {tab === 'layers' && <Layers {...props} />}
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

function Layers({ tree, activeStory, selectedLoc, onSelectLayer, onHoverLayer }: Props) {
  if (!activeStory) return <p className="hint">Cliquez sur un écran pour voir ses calques.</p>;
  if (tree.length === 0) return <p className="hint">Chargement des calques…</p>;
  return (
    <ul className="layers" onMouseLeave={() => onHoverLayer(null)}>
      {tree.map((node) => (
        <Layer key={node.key} node={node} depth={0} selectedLoc={selectedLoc} onSelect={onSelectLayer} onHover={onHoverLayer} />
      ))}
    </ul>
  );
}

function Layer({ node, depth, selectedLoc, onSelect, onHover }: { node: LayerNode; depth: number; selectedLoc: string | null; onSelect: (loc: string) => void; onHover: (loc: string | null) => void }) {
  const [open, setOpen] = useState(depth < 3);
  const file = node.loc.split(':')[0].split('/').pop();
  const isComponent = /^[A-Z]/.test(node.name) && !BUILTINS.has(node.name);
  return (
    <li>
      <div
        className={`layer ${selectedLoc === node.loc ? 'selected' : ''}`}
        style={{ paddingLeft: 8 + depth * 12 }}
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
            <Layer key={child.key} node={child} depth={depth + 1} selectedLoc={selectedLoc} onSelect={onSelect} onHover={onHover} />
          ))}
        </ul>
      )}
    </li>
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
