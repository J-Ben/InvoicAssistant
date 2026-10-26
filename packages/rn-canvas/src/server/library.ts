/**
 * Bibliothèque de composants : les composants exportés par le projet, avec leurs props
 * obligatoires (lues dans l'interface `<Nom>Props`), plus quelques primitives React Native.
 */
import type { ComponentEntry } from '../shared/protocol.ts';
import { type AstNode, type SourceFile, programOf, unwrap } from './ast.ts';

export const PRIMITIVES: ComponentEntry[] = ['View', 'Text', 'ScrollView', 'TextInput', 'Pressable'].map((name) => ({
  name,
  file: null,
  group: 'React Native',
  props: [],
}));

type PropType = ComponentEntry['props'][number]['type'];

export function componentsOf(file: string, src: SourceFile): ComponentEntry[] {
  const program = programOf(src.ast);
  const group = groupOf(file);
  const out: ComponentEntry[] = [];

  for (const stmt of program.body) {
    if (stmt.type !== 'ExportNamedDeclaration' || !stmt.declaration) continue;
    const decl = stmt.declaration;
    const names: string[] = [];
    if (decl.type === 'FunctionDeclaration' && decl.id) names.push(decl.id.name);
    if (decl.type === 'VariableDeclaration') {
      for (const d of decl.declarations) {
        const init = d.init ? unwrap(d.init) : null;
        const isComponent = init && ['ArrowFunctionExpression', 'FunctionExpression', 'CallExpression'].includes(init.type);
        if (d.id.type === 'Identifier' && isComponent) names.push(d.id.name);
      }
    }
    for (const name of names) {
      if (!/^[A-Z]/.test(name)) continue;
      out.push({ name, file, group, props: requiredProps(program, `${name}Props`) });
    }
  }
  return out;
}

function groupOf(file: string): string {
  const parts = file.split('/');
  return parts.length > 1 ? parts[parts.length - 2] : 'Projet';
}

/** Props obligatoires de `interface XProps { … }` ou `type XProps = { … }`. */
function requiredProps(program: AstNode, typeName: string): ComponentEntry['props'] {
  for (const stmt of program.body) {
    const decl = stmt.type === 'ExportNamedDeclaration' && stmt.declaration ? stmt.declaration : stmt;
    let members: AstNode[] | null = null;
    if (decl.type === 'TSInterfaceDeclaration' && decl.id.name === typeName) members = decl.body.body;
    if (decl.type === 'TSTypeAliasDeclaration' && decl.id.name === typeName && decl.typeAnnotation.type === 'TSTypeLiteral') {
      members = decl.typeAnnotation.members;
    }
    if (!members) continue;
    return members
      .filter((m) => m.type === 'TSPropertySignature' && !m.optional && m.key.type === 'Identifier')
      .map((m) => ({ name: m.key.name as string, type: propType(m.typeAnnotation?.typeAnnotation) }));
  }
  return [];
}

function propType(node: AstNode | undefined): PropType {
  switch (node?.type) {
    case 'TSStringKeyword':
      return 'string';
    case 'TSNumberKeyword':
      return 'number';
    case 'TSBooleanKeyword':
      return 'boolean';
    case 'TSFunctionType':
      return 'function';
    case 'TSArrayType':
      return 'array';
    case 'TSTypeReference':
      return node.typeName?.name === 'Array' ? 'array' : 'unknown';
    default:
      return 'unknown';
  }
}
