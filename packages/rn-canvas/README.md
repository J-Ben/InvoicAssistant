# rn-canvas

Éditeur visuel **aller-retour** pour React Native : vos écrans s'affichent côte à côte sur un canevas façon Figma, vous les modifiez à la souris, et **les modifications sont écrites directement dans votre code**.

- Votre code reste la seule référence : rien n'est stocké à côté, rien ne peut se désynchroniser.
- Les modifications sont chirurgicales : seuls les caractères qui changent sont réécrits (indentation, guillemets et commentaires intacts).
- Aucun impact sur l'app : l'instrumentation n'existe que dans le bundle **web de développement**.

## Prérequis

- Un projet Expo qui tourne sur le web (`react-native-web`, `react-dom`, `@expo/metro-runtime`).
- Node 22.18 ou plus récent.

## Installation

```bash
npm i -D rn-canvas
npx rn-canvas init
```

`init` crée `rn-canvas.json`, ajoute le plugin à `babel.config.js`, branche le point d'entrée et ajoute le script `npm run canvas`. Il liste ce qu'il reste à faire, s'il y a lieu.

Avec **expo-router**, `init` branche `app/_layout.tsx` (la mise en page racine) au lieu du point d'entrée, et range les stories dans `canvas/` : dans `app/`, chaque fichier deviendrait une route.

Branchement manuel du point d'entrée, si `init` ne peut pas le faire :

```ts
import { registerRootComponent } from 'expo';
import { withCanvas } from 'rn-canvas/runtime';
import App from './App';

registerRootComponent(__DEV__ ? withCanvas(App, () => require('./rn-canvas.stories').default) : App);
```

## Déclarer des écrans

Un fichier `*.canvas.tsx` à côté de l'écran ; chaque export nommé est une variante affichée sur le canevas :

```tsx
import type { CanvasMeta, CanvasStory } from 'rn-canvas/runtime';
import { HomeScreen } from './HomeScreen';
import { useChatStore } from '../store/chatStore';

export default { title: 'Accueil', component: HomeScreen } satisfies CanvasMeta;

export const Vide: CanvasStory = {
  setup: () => useChatStore.getState().setMessages([]),
};

export const AvecDonnees: CanvasStory = {
  props: { user: mockUser },
  parameters: { route: { id: 42 } },
};
```

| Champ | Rôle |
|---|---|
| `props` | Props passées au `component` de l'export par défaut |
| `render` | Rendu personnalisé (prioritaire sur `component`) |
| `setup` | Exécuté avant le premier rendu, pour remplir un store par exemple. Peut retourner une fonction de nettoyage. |
| `parameters` | Données libres transmises au wrapper, comme les paramètres de route |
| `wrapper` | Fournisseurs propres à la variante, à l'intérieur de ceux de `rn-canvas.config.tsx` : ils peuvent utiliser les hooks de l'app |
| `storage` | Stockage du navigateur (localStorage, donc AsyncStorage sur le web) restauré avant le rendu. Écrit par l'éditeur avec « ＋ » |

**Variantes pré-remplies.** Deux façons d'afficher un écran dans un état précis (vide, chargé, erreur…) sans repasser par le mode Interaction :

- **Sans code** : remplissez l'écran en mode Interaction, puis cliquez sur « ＋ » à côté de la variante dans l'onglet Écrans et donnez-lui un nom. L'éditeur capture le stockage de l'écran et écrit `export const MaVariante = { ...Base, storage: {…} }` dans le fichier canvas.
- **En code**, pour des données qui ne sont pas dans le stockage (base SQLite, API…) : un `wrapper` de variante et `CanvasSeed`, qui affiche l'écran une fois les données prêtes.

```tsx
import { CanvasSeed, type CanvasStory } from 'rn-canvas/runtime';

export const BudgetRempli: CanvasStory = {
  wrapper: ({ children }) => {
    const di = useDI();
    return <CanvasSeed run={() => seedBudget(di)}>{children}</CanvasSeed>;
  },
};
```

Les fournisseurs communs (navigation, thème, React Query…) se déclarent une fois dans `rn-canvas.config.tsx` :

```tsx
import type { CanvasRuntimeConfig } from 'rn-canvas/runtime';

export default {
  wrapper: ({ children, story }) => <Providers>{children}</Providers>,
} satisfies CanvasRuntimeConfig;
```

## Utilisation

```bash
npm run canvas        # = rn-canvas dev : démarre Expo si besoin, puis l'éditeur
```

Ouvrez **http://localhost:7007**.

- **Sélection (V)** : un clic sur un élément ouvre l'inspecteur (texte, props, styles). Comme dans Figma : un **clic** sélectionne l'élément tel qu'il est écrit dans l'écran (ex. `<QuickActionsSection>`) ; un **double-clic** descend d'un niveau dans le composant ; une fois à l'intérieur, les clics suivants restent à ce niveau ; **Alt+clic** sélectionne l'élément exact (le modifier touche alors toutes les instances du composant).
- **Interaction (I)** : l'app réagit normalement (boutons, saisie…).
- Le **fil d'Ariane** permet de remonter du `Text` interne d'un composant à son instance dans l'écran. On modifie alors soit le composant (toutes ses instances), soit seulement les props de cette instance, comme les composants principaux et les instances de Figma.
- **Styles** : choisissez la cible. Un style partagé de `StyleSheet.create` touche tous les éléments qui l'utilisent ; « Cet élément uniquement » ajoute une surcharge (`[styles.x, { … }]`).
- **Jetons** : tapez `colors.primary` pour référencer le thème plutôt qu'une valeur en dur.
- **Thème** : l'onglet Thème modifie l'objet configuré (`theme` dans `rn-canvas.json`), et donc toute l'app.
- **Champs** : chaque propriété a le champ adapté. Valeurs numériques : **⌘/Ctrl + molette** ou flèches ↑/↓ pour les ajuster (Maj ×10, Alt ×0,1), écriture dans le code à la fin du réglage. Directions et alignements : boutons ou listes. Couleurs : pastille et sélecteur de jetons du thème.
- **Styles calculés** : une valeur qui n'est pas écrite en dur (`color ?? colors.text`, `typography[variant]`, prop `style`…) est expliquée : prop du composant, hook (`useTheme()`, avec sa ligne), import ou variable locale, avec sa valeur effective. Si elle vient d'une prop, un lien sélectionne l'instance où la régler.
- **Annuler / rétablir** : ⌘Z et ⇧⌘Z (ou les flèches de la barre du haut), y compris pour les modifications faites par une IA via MCP. Un fichier modifié entre-temps dans votre éditeur de code n'est jamais écrasé : l'annulation est alors refusée.
- **Structure** : boutons Dupliquer et Supprimer de l'inspecteur, ou raccourcis ⌘/Ctrl+D et Suppr. **Glissez un élément directement sur l'écran** (ou dans l'onglet Calques) pour le déplacer : en haut de la cible pour le placer avant, en bas pour après, au milieu pour le mettre dedans. Un repère vert montre l'emplacement, rouge si le déplacement est impossible (autre fichier, dans lui-même).
- **Composants** : l'onglet liste les composants exportés par le projet et quelques primitives React Native. Un clic insère le composant dans l'élément sélectionné (s'il s'agit d'un conteneur) ou juste après ; on peut aussi le **glisser sur l'écran** ou vers les calques. L'import est ajouté, et les props obligatoires (lues dans l'interface `NomProps`) reçoivent des valeurs d'exemple.
- **Thème de l'éditeur** : le bouton Système / Clair / Sombre de la barre du haut. Le choix est mémorisé dans le navigateur.

## Piloter les écrans depuis une IA (MCP)

`rn-canvas mcp` lance un serveur [MCP](https://modelcontextprotocol.io) qui donne à une IA les mêmes opérations que l'éditeur. Il n'a pas besoin du navigateur : il travaille directement sur le code.

```bash
claude mcp add rn-canvas -- npx rn-canvas mcp
```

| Outil | Rôle |
|---|---|
| `list_screens`, `list_components`, `get_theme` | Découvrir le projet |
| `list_elements` | Arbre JSX d'un fichier, avec les emplacements `fichier:ligne:colonne` |
| `inspect_element` | Texte, props et styles d'un élément, avec leur origine |
| `set_style`, `set_text`, `set_prop`, `set_token` | Modifier des valeurs (`"colors.primary"` est accepté comme jeton) |
| `move_element`, `duplicate_element`, `delete_element`, `insert_component` | Modifier la structure |

Si l'éditeur est ouvert en même temps, il affiche les modifications de l'IA en direct grâce au Fast Refresh.

## Configuration (`rn-canvas.json`)

```json
{
  "appUrl": "http://localhost:8081",
  "include": ["src"],
  "theme": { "file": "src/theme/colors.ts", "export": "colors", "alias": "colors" },
  "isolateStories": true
}
```

`theme.alias` (optionnel) : nom sous lequel les composants accèdent au thème, s'il diffère de l'export. Par exemple `"export": "LIGHT_COLORS", "alias": "colors"` quand les composants écrivent `const { colors } = useTheme()` : le sélecteur de jetons propose alors `colors.primary`.

`isolateStories` (activé par défaut si l'app tourne sur `localhost`) : chaque écran est servi depuis son propre sous-domaine (`accueil-actuel-1k2j.localhost:8081`), que les navigateurs résolvent vers la machine locale. Chaque écran a ainsi son propre stockage (localStorage, IndexedDB, OPFS) : pas de conflit entre écrans affichés en parallèle, ce qui est indispensable pour expo-sqlite sur le web, dont la base ne s'ouvre que dans un seul onglet à la fois.

## Fonctionnement

```
plugin Babel ──▶ chaque élément JSX reçoit __rnc="fichier:ligne:colonne:Nom"
runtime      ──▶ dans l'app web : écran isolé (?rnc-story=…), lecture de l'arbre React, surbrillance, postMessage
serveur      ──▶ analyse le code (@babel/parser) et applique des patchs texte minimaux
éditeur      ──▶ canevas, calques, inspecteur ; le Fast Refresh d'Expo affiche le résultat
```

Le serveur n'écoute que sur `127.0.0.1` et refuse les requêtes d'autres origines. Il n'écrit que dans les fichiers du projet (jamais `node_modules`) et vérifie que le code produit reste valide avant d'écrire.

## Limites actuelles

- Les valeurs dynamiques (`{user.name}`, styles calculés) s'affichent en lecture seule.
- Les modifications de structure ne concernent que les enfants directs d'un élément JSX. Un élément affiché sous condition (`{cond && <X />}`), dans une liste (`.map`) ou à la racine d'un composant se modifie dans le code.
- Les déplacements se font dans un même fichier. Pour sortir un élément d'un composant, il faut passer par le code.
- Seuls les modules qui fonctionnent sur le web peuvent s'afficher. Les autres (notifications, système de fichiers, widgets…) doivent être neutralisés sur le web : `Platform.OS === 'web'`, fichier `.web.ts`, ou simulation dans `setup` ou dans le wrapper.

## Publication

Le nom `rn-canvas` est déjà pris sur npm : il faut en choisir un autre avant de publier (par exemple avec un scope : `@votre-compte/rn-canvas`). Pour le changer, modifiez le champ `name` de `package.json` et les imports `rn-canvas/babel` et `rn-canvas/runtime` dans le projet hôte, puis :

```bash
npm publish --access public   # lance d'abord les tests, la vérification des types et le build
```

## Développement du package

```bash
npm run build       # CLI + éditeur → dist/
npm run dev:editor  # reconstruction à la volée
npm test            # tests (node --test)
npm run typecheck
```
