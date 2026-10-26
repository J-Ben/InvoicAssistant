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

- **Sélection (V)** : un clic sur un élément ouvre l'inspecteur (texte, props, styles).
- **Interaction (I)** : l'app réagit normalement (boutons, saisie…).
- Le **fil d'Ariane** permet de remonter du `Text` interne d'un composant à son instance dans l'écran. On modifie alors soit le composant (toutes ses instances), soit seulement les props de cette instance, comme les composants principaux et les instances de Figma.
- **Styles** : choisissez la cible. Un style partagé de `StyleSheet.create` touche tous les éléments qui l'utilisent ; « Cet élément uniquement » ajoute une surcharge (`[styles.x, { … }]`).
- **Jetons** : tapez `colors.primary` pour référencer le thème plutôt qu'une valeur en dur.
- **Thème** : l'onglet Thème modifie l'objet configuré (`theme` dans `rn-canvas.json`), et donc toute l'app.

## Configuration (`rn-canvas.json`)

```json
{
  "appUrl": "http://localhost:8081",
  "include": ["src"],
  "theme": { "file": "src/theme/colors.ts", "export": "colors" }
}
```

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
- Il n'est pas encore possible d'ajouter, de supprimer ou de déplacer des éléments.
- Seuls les modules qui fonctionnent sur le web peuvent s'afficher ; les autres doivent être simulés dans `setup` ou dans le wrapper.

## Développement du package

```bash
npm run build       # CLI + éditeur → dist/
npm run dev:editor  # reconstruction à la volée
npm test            # tests (node --test)
npm run typecheck
```
