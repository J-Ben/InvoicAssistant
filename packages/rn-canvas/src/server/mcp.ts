/**
 * Serveur MCP (Model Context Protocol) sur stdio : expose à une IA les mêmes opérations
 * que l'éditeur. JSON-RPC 2.0, un message par ligne ; les journaux vont sur stderr.
 *
 *   claude mcp add rn-canvas -- npx rn-canvas mcp
 */
import readline from 'node:readline';
import type { EditRequest, EditValue, InsertPosition } from '../shared/protocol.ts';
import { SourceError } from './inspect.ts';
import type { Project } from './project.ts';

const PROTOCOL_VERSION = '2025-06-18';

interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run: (args: Record<string, unknown>) => unknown;
}

const LOC = { type: 'string', description: 'Emplacement `fichier:ligne:colonne` (obtenu avec list_elements).' };
const NAME = { type: 'string', description: "Nom de l'élément à cet emplacement (ex. View), pour détecter un emplacement périmé." };
const VALUE = {
  description: 'Nombre, chaîne, booléen, jeton du thème (ex. "colors.primary") ou null pour retirer.',
  type: ['string', 'number', 'boolean', 'null'],
};
const POSITION = { type: 'string', enum: ['before', 'after', 'inside'] };

function schema(properties: Record<string, unknown>, required: string[]) {
  return { type: 'object', properties, required, additionalProperties: false };
}

/** Valeur JSON → valeur d'édition : "colors.primary" devient un jeton s'il est en portée dans le fichier. */
function toEditValue(value: unknown, scope: string[]): EditValue {
  if (value === null || value === undefined) return { kind: 'remove' };
  if (typeof value === 'string' && /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)+$/.test(value) && scope.includes(value.split('.')[0])) {
    return { kind: 'expression', code: value };
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return { kind: 'literal', value };
  throw new SourceError('Valeur invalide.');
}

export function mcpTools(project: Project): Tool[] {
  const str = (args: Record<string, unknown>, key: string) => {
    const v = args[key];
    if (typeof v !== 'string' || !v) throw new SourceError(`Paramètre « ${key} » manquant.`);
    return v;
  };
  const edit = (request: EditRequest) => project.edit(request);
  const scopeOf = (loc: string, name: string) => project.inspect(loc, name).scope;

  return [
    {
      name: 'list_screens',
      description: 'Liste les écrans déclarés (fichiers *.canvas.tsx) et leurs variantes.',
      inputSchema: schema({}, []),
      run: () => project.stories(),
    },
    {
      name: 'list_components',
      description: 'Liste les composants insérables (projet + primitives React Native) avec leurs props obligatoires.',
      inputSchema: schema({}, []),
      run: () => project.components(),
    },
    {
      name: 'get_theme',
      description: 'Jetons du thème (couleurs…) et leurs valeurs.',
      inputSchema: schema({}, []),
      run: () => project.theme(),
    },
    {
      name: 'list_elements',
      description: "Arbre des éléments JSX d'un fichier, avec leur emplacement, à utiliser dans les autres outils.",
      inputSchema: schema({ file: { type: 'string', description: 'Chemin relatif au projet, ex. src/screens/HomeScreen.tsx' } }, ['file']),
      run: (args) => project.elements(str(args, 'file')),
    },
    {
      name: 'inspect_element',
      description: "Texte, props et styles d'un élément, avec l'origine de chaque style (inline ou StyleSheet).",
      inputSchema: schema({ loc: LOC, name: NAME }, ['loc']),
      run: (args) => project.inspect(str(args, 'loc'), args.name as string | undefined),
    },
    {
      name: 'set_style',
      description:
        'Modifie une propriété de style. target "instance" (défaut) ne touche que cet élément ; "styles.xxx" modifie le style partagé de StyleSheet.create.',
      inputSchema: schema({ loc: LOC, name: NAME, key: { type: 'string' }, value: VALUE, target: { type: 'string' } }, ['loc', 'name', 'key', 'value']),
      run: (args) => {
        const loc = str(args, 'loc');
        const name = str(args, 'name');
        const target = typeof args.target === 'string' && args.target !== 'instance' ? { kind: 'stylesheet' as const, ref: args.target } : { kind: 'instance' as const };
        return edit({ op: 'setStyle', loc, name, key: str(args, 'key'), value: toEditValue(args.value, scopeOf(loc, name)), target });
      },
    },
    {
      name: 'set_text',
      description: "Remplace le texte statique d'un élément (ex. <Text>).",
      inputSchema: schema({ loc: LOC, name: NAME, text: { type: 'string' } }, ['loc', 'name', 'text']),
      run: (args) => edit({ op: 'setText', loc: str(args, 'loc'), name: str(args, 'name'), value: String(args.text ?? '') }),
    },
    {
      name: 'set_prop',
      description: 'Ajoute, modifie ou retire (value null) une prop littérale.',
      inputSchema: schema({ loc: LOC, name: NAME, prop: { type: 'string' }, value: VALUE }, ['loc', 'name', 'prop', 'value']),
      run: (args) => {
        const loc = str(args, 'loc');
        const name = str(args, 'name');
        return edit({ op: 'setProp', loc, name, prop: str(args, 'prop'), value: toEditValue(args.value, scopeOf(loc, name)) });
      },
    },
    {
      name: 'set_token',
      description: "Modifie la valeur d'un jeton du thème (s'applique à toute l'app), ex. path \"colors.primary\".",
      inputSchema: schema({ path: { type: 'string' }, value: { type: ['string', 'number'] } }, ['path', 'value']),
      run: (args) => edit({ op: 'setToken', path: str(args, 'path'), value: { kind: 'literal', value: args.value as string | number } }),
    },
    {
      name: 'move_element',
      description: 'Déplace un élément avant/après un autre, ou à la fin de ses enfants (inside). Même fichier uniquement.',
      inputSchema: schema({ loc: LOC, name: NAME, target: LOC, targetName: NAME, position: POSITION }, ['loc', 'name', 'target', 'targetName', 'position']),
      run: (args) =>
        edit({
          op: 'move',
          loc: str(args, 'loc'),
          name: str(args, 'name'),
          target: str(args, 'target'),
          targetName: str(args, 'targetName'),
          position: str(args, 'position') as InsertPosition,
        }),
    },
    {
      name: 'duplicate_element',
      description: 'Duplique un élément juste après lui.',
      inputSchema: schema({ loc: LOC, name: NAME }, ['loc', 'name']),
      run: (args) => edit({ op: 'duplicate', loc: str(args, 'loc'), name: str(args, 'name') }),
    },
    {
      name: 'delete_element',
      description: 'Supprime un élément (et ses enfants).',
      inputSchema: schema({ loc: LOC, name: NAME }, ['loc', 'name']),
      run: (args) => edit({ op: 'remove', loc: str(args, 'loc'), name: str(args, 'name') }),
    },
    {
      name: 'insert_component',
      description: 'Insère un composant de la bibliothèque (voir list_components) par rapport à un élément ; ajoute l’import si besoin.',
      inputSchema: schema(
        { loc: LOC, name: NAME, position: POSITION, component: { type: 'string' }, componentFile: { type: ['string', 'null'], description: 'null pour une primitive React Native' } },
        ['loc', 'name', 'position', 'component'],
      ),
      run: (args) =>
        edit({
          op: 'insert',
          loc: str(args, 'loc'),
          name: str(args, 'name'),
          position: str(args, 'position') as InsertPosition,
          component: { name: str(args, 'component'), file: (args.componentFile as string | null | undefined) ?? null },
        }),
    },
  ];
}

interface RpcMessage {
  jsonrpc: '2.0';
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

/** Traite un message JSON-RPC ; retourne la réponse, ou null pour une notification. */
export function handleRpc(tools: Tool[], message: RpcMessage, version: string): object | null {
  const { id, method, params = {} } = message;
  const reply = (result: unknown) => ({ jsonrpc: '2.0', id, result });
  const fail = (code: number, msg: string) => ({ jsonrpc: '2.0', id, error: { code, message: msg } });
  if (id === undefined) return null;

  switch (method) {
    case 'initialize':
      return reply({
        protocolVersion: typeof params.protocolVersion === 'string' ? params.protocolVersion : PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: 'rn-canvas', version },
        instructions:
          "Éditeur visuel React Native. Utilisez list_screens / list_elements pour trouver les emplacements (fichier:ligne:colonne), inspect_element pour lire, puis les outils set_* / move / insert pour modifier le code. Après une modification, les emplacements situés plus bas dans le fichier peuvent changer : relancez list_elements.",
      });
    case 'ping':
      return reply({});
    case 'tools/list':
      return reply({ tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    case 'tools/call': {
      const tool = tools.find((t) => t.name === params.name);
      if (!tool) return fail(-32602, `Outil inconnu : ${String(params.name)}`);
      try {
        const result = tool.run((params.arguments as Record<string, unknown>) ?? {});
        return reply({ content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
      } catch (error) {
        return reply({ content: [{ type: 'text', text: (error as Error).message }], isError: true });
      }
    }
    default:
      return fail(-32601, `Méthode inconnue : ${method}`);
  }
}

export function serveMcp(project: Project, version: string): void {
  const tools = mcpTools(project);
  const rl = readline.createInterface({ input: process.stdin });
  rl.on('line', (line) => {
    if (!line.trim()) return;
    let message: RpcMessage;
    try {
      message = JSON.parse(line);
    } catch {
      process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'JSON invalide' } })}\n`);
      return;
    }
    const response = handleRpc(tools, message, version);
    if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
  });
  rl.on('close', () => process.exit(0));
  console.error('[rn-canvas] serveur MCP prêt (stdio).');
}
