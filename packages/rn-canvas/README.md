# rn-canvas

Éditeur visuel **aller-retour** pour React Native : vos écrans s'affichent côte à côte sur un canevas façon Figma, vous les modifiez à la souris, et **les modifications sont écrites directement dans votre code**.

- Votre code reste la seule référence : rien n'est stocké à côté, rien ne peut se désynchroniser.
- Les modifications sont chirurgicales : seuls les caractères qui changent sont réécrits (indentation, guillemets et commentaires intacts).
- Aucun impact sur l'app : l'instrumentation n'existe que dans le bundle **web de développement**.

## Prérequis

- Un projet Expo qui tourne sur le web (`react-native-web`, `react-dom`, `@expo/metro-runtime`).
- Node 20.19 ou plus récent (comme Expo SDK 58). Les tests du package demandent Node 22.18.

## Installation

```bash
npm i -D rn-canvas
npx rn-canvas init
```

`init` crée `rn-canvas.json`, ajoute le plugin à `babel.config.js`, branche le point d'entrée (`registerRootComponent(App)` ou `AppRegistry.registerComponent(name, () => App)`, fichier donné par `main` du package.json, sinon `index.js`/`index.ts`), enveloppe `metro.config.js` et ajoute le script `npm run canvas`. Tout ce qu'il écrit reste inoffensif sans le paquet installé (collègue, CI, build natif) : les `require` de rn-canvas sont protégés par `try`, et le canevas n'existe qu'en développement web. Il prépare aussi le canevas à partir du code existant, sans rien écraser :

- **Fournisseurs** : `rn-canvas.config.tsx` reprend la chaîne d'éléments qui enveloppe la navigation dans `app/_layout.tsx`, ou dans le composant enregistré par le point d'entrée (`App.tsx`, `app/app.tsx`…), y compris enveloppé de HOC (`Sentry.wrap(codePush(opts)(App))`) : thème, stores, gestes, `useFonts` et sa condition d'attente… La navigation et ce qui s'affiche à côté (splash, verrouillage, barre d'état) sont laissés de côté, comme la télémétrie et les mises à jour OTA (Sentry, CodePush, OneSignal…). `PersistQueryClientProvider` devient un `QueryClientProvider` sans persistance ; les portails (`PortalHost`) restent à leur place, un toast piloté par une ref est écarté. Une prop calculée dans le layout (`value={client}` issu d'un hook) ne peut pas toujours être reprise : elle est listée en tête du fichier. Si rien n'est reconnu, un fichier à compléter est écrit, avec la raison.
- **Écrans** : un fichier `canvas/<Nom>.canvas.tsx` par route de `app/` (expo-router), ou par `<Stack.Screen name component>` (React Navigation, voir plus bas). Un paramètre de route reçoit une valeur d'exemple (`params: { id: '1' }`), à remplacer.
- **Données d'exemple** (TypeScript) : `canvas/examples.generated.ts`, tiré des types des props de chaque composant (voir « Aperçus des composants »).

Il liste ce qu'il reste à faire, s'il y a lieu. Chaque étape se relance seule : `npx rn-canvas providers` (`--print` pour seulement afficher la proposition), `npx rn-canvas screens`, `npx rn-canvas examples`.

Avec **expo-router**, `init` branche `app/_layout.tsx` (la mise en page racine) au lieu du point d'entrée, et range les stories dans `canvas/` : dans `app/`, chaque fichier deviendrait une route. **Sans expo-router**, `app/` n'est qu'un dossier de sources comme `src/` : `init` l'ajoute à `include`.

### React Navigation (sans expo-router)

Chaque écran du canevas est rendu dans son propre conteneur React Navigation (`NavigationIndependentTree` en v7, `independent` en v6), avec une pile à un seul écran créée par `@react-navigation/native-stack` (ou `@react-navigation/stack`) :

- l'écran reçoit `navigation` et `route` en props, et `useNavigation()`/`useRoute()` fonctionnent, y compris dans les aperçus des composants ;
- `route.params` vaut le `params` du fichier canvas (`params: { invoiceId: 'F-104' }`) ;
- une navigation vers un autre écran (`navigate('Detail')`, `goBack()`) n'est pas jouée : l'écran reste affiché seul et l'éditeur la signale.

`npx rn-canvas screens` lit les `<X.Screen name="…" component={…} />` (et `getComponent`, et l'API statique `createNativeStackNavigator({ screens })`), suit les imports et réexports jusqu'au fichier de l'écran, et tire les paramètres requis des types `…ParamList` (`InvoiceDetail: { invoiceId: string }` → `params: { invoiceId: '1' }`), sinon des `route.params.x` lus par l'écran. Si un écran plante sur `Cannot read properties of undefined (reading 'x')` sans `params` déclarés, le message d'erreur le suggère.

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
| `params` | Paramètres de route, dans la variante ou l'export par défaut : `{ id: '42' }`. Lus par `useLocalSearchParams()` (expo-router) ou `route.params` / `useRoute()` (React Navigation) |

Un paramètre connu seulement au rendu (l'identifiant d'une facture créée par `CanvasSeed`) se passe avec `<RouteParams params={{ id }}><Screen /></RouteParams>` dans un `render`.

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
- **Flux** (projets expo-router) : le bouton ⇢ Flux dessine les liens de navigation lus dans le code (`router.push/replace/navigate`, `<Link href>`), du bouton exact vers l'écran visé. Survolez un écran pour mettre ses liens en avant. La légende compte les liens vers des écrans absents du canevas et les boutons non affichés dans l'état actuel (liste vide…). Une cible calculée (`router.push(route)`) n'est pas lisible dans le code et n'apparaît pas.
- **Pages et parcours** : les onglets en haut à gauche du canevas. La **vue d'ensemble** montre tous les écrans ; **＋ Parcours** crée une page qui n'en reprend qu'une sélection (cochez-les dans l'onglet Écrans), avec sa propre disposition, ses groupes et ses notes : ranger un parcours ne change jamais la vue d'ensemble. Double-clic sur un onglet pour le renommer.
- **Groupes** (▢ Groupe) : un cadre de couleur titré, autour de l'écran actif ou au centre de la vue. Les écrans et notes dont le centre est dedans en font partie : glisser le titre déplace le groupe avec son contenu, le coin le redimensionne. Double-clic sur le titre pour le renommer ; boutons pour la couleur, la suppression (les écrans restent) et « ⇢ Parcours », qui crée un parcours avec les écrans du groupe.
- **Notes** (✎ Note) : un bloc de texte libre. Double-clic pour l'écrire, glisser pour la déplacer, bord droit pour l'élargir.
- **Flux et groupes** : quand la page a des groupes, la légende du mode Flux propose **Tous les liens**, **Dans les groupes** (seulement entre écrans d'un même groupe ; les sorties sont résumées sur chaque groupe : « → Budget · 3 ») et **Entre groupes** (une flèche par paire de groupes, avec le nombre de liens).
- Pages, groupes et notes sont enregistrés dans `canvas/parcours.json` (option `board`), à versionner avec le projet : toute l'équipe retrouve les mêmes parcours.
- **Barre de la bibliothèque** (en bas du canevas) : Texte, Bouton, Champ et Conteneur (composants du projet comme `AppText`, `Button`, `Input` s'ils existent, sinon les primitives React Native), puis les atomes, molécules, organismes et autres composants du projet, avec recherche. Un clic insère dans l'élément sélectionné (conteneur) ou juste après, sinon dans l'écran actif ; on peut aussi glisser sur un écran.
- **Aperçus des composants** : l'onglet Composants et les menus de la barre montrent le rendu réel de chaque composant (bascule Aperçus / Liste). Pour ceux qui exigent des données (une facture, une ligne de budget…), déclarez des exemples dans `rn-canvas.config.tsx` :

  ```tsx
  const config: CanvasRuntimeConfig = {
    wrapper: Providers,
    examples: {
      InvoiceCard: [
        { name: 'Payée', props: { invoice: fixtures.invoices[0], onPress: () => {} } },
        { name: 'En attente', props: { invoice: fixtures.invoices[1], onPress: () => {} } },
      ],
      ProgressBar: { props: { progress: 0.6 } },
    },
  };
  ```

  Chaque exemple donne une vignette ; ses props remplacent les valeurs génériques (« Label », 0…).

  Pour ne pas tout écrire à la main, `npx rn-canvas examples` (lancé aussi par `init`) génère `canvas/examples.generated.ts` à partir des **types TypeScript** des props, avec le compilateur du projet : classes du projet instanciées (`new Invoice({…})`), unions (première valeur), tableaux de deux éléments, rappels vides, et des valeurs qui suivent le nom des champs (`amount` → un montant, `date` → une date récente, `vendor` → « Carrefour », `visible` → `true`…). Elles sont plausibles, pas cohérentes entre elles. Branchez-les avant les vôtres, qui restent prioritaires : `examples: { ...generatedExamples, ...vosExemples }`. Le fichier est réécrit à chaque génération (et au démarrage de `rn-canvas dev` s'il existe) : copiez un exemple dans la configuration pour le retoucher. Les modales et panneaux qui s'affichent par-dessus l'écran n'ont pas d'aperçu en vignette : leur bouton **Ouvrir en grand** crée l'écran `canvas/components/<Nom>.canvas.tsx` (s'il n'existe pas), qui affiche le composant ouvert, en taille réelle, avec son exemple (`example: '<Nom>'` dans le `default`, `example: 'variante'` dans une story pour en choisir une). Les panneaux pilotés par ref (`BottomSheetModal` de @gorhom…) sont ouverts automatiquement (`present()`).
- **Palette contextuelle** : à droite de l'écran (à gauche s'il n'y a pas la place), à la hauteur de l'élément sélectionné, sans jamais le masquer : ce qui est trop proche dans sa rangée glisse de côté le temps de la sélection : écrans, notes et groupes, et le groupe de l’écran s’élargit d’autant (décalage visuel, la disposition enregistrée ne change pas). Couleur de fond et couleur du texte (sélecteur, valeur ou jetons du thème), couleurs et direction du dégradé (`LinearGradient` de l'élément ou de son calque de fond), taille du texte, gras, alignement, rayon des coins, opacité ; « Tous les réglages » ouvre le panneau de droite sur la section Style. Elle signale un style partagé (« partagé ×3 ») ou un élément écrit dans le fichier d'un composant (« toutes les instances »).
- **Poignées sur l'élément** : points dans les coins pour le rayon (Alt : un seul coin), barres roses pour la marge intérieure et orange pour la marge extérieure (Alt : les deux côtés de l'axe, Maj : tous les côtés), barre verte pour l'espacement entre enfants, et bords bleus pour la largeur et la hauteur quand elles sont écrites dans le code. L'élément change en direct pendant le glisser, la valeur s'affiche à côté du pointeur et s'aimante sur les multiples de 4 (⌘/Ctrl : valeur libre) ; le code est écrit au relâchement, en une seule étape d'annulation. Un raccourci (`padding`, `borderRadius`) remplace les variantes plus précises déjà écrites.
- **Texte sur place** : double-clic sur un texte sélectionné dont le contenu est écrit en dur, Entrée pour valider, Échap pour annuler.
- **Raccourcis d'espacement** : ⌘/Ctrl + ↑/↓ pour la marge intérieure, Alt + ↑/↓ pour la marge extérieure, de 4 en 4 (Maj : de 1 en 1).
- **Clic droit** sur un élément (dans l'écran ou dans les calques) : Dupliquer, Copier le code JSX, Copier l'emplacement, Ouvrir dans VS Code, Sélectionner le parent, Supprimer.
- **Dégradés** (`expo-linear-gradient`, `react-native-linear-gradient`) : la section « Fond dégradé » apparaît pour un `LinearGradient` ou pour un élément dont c'est le calque de fond (`absoluteFill`). Aperçu, couleurs réellement rendues (même calculées), modification de chaque couleur (valeur ou jeton du thème), ajout / retrait, direction.
- **Version** : affichée à côté du nom du projet, pour vérifier quelle version de l'éditeur tourne.
- **Disposition** : glissez un écran par son nom (au-dessus du cadre) pour le placer où vous voulez ; il s'aligne sur la grille de points (Alt : placement libre). Les positions sont enregistrées par page dans `canvas/parcours.json` ; le bouton ⊞ remet la grille d’origine de la page.
- **Zoom** : ⌘/Ctrl + molette (ou pincement du trackpad), y compris au-dessus d'un écran ; ⌘/Ctrl + / − ; ⌘/Ctrl 0 ou Maj 1 pour tout afficher ; Maj 0 pour 100 %. La vue est mémorisée : ni un rechargement ni l'affichage / le masquage d'un écran ne la changent.
- **Navigation** : un écran du canevas reste affiché seul. Une redirection ou un `router.push` y est ignoré et signalé par une notification.
- **Un seul onglet** : les écrans partagent leurs bases de données d'un onglet à l'autre ; un deuxième onglet de l'éditeur propose « Utiliser cet onglet ». Avec Brave, si les écrans affichent des erreurs de stockage, désactivez les Shields pour `localhost`.

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
  "include": ["src", "canvas"],
  "theme": { "file": "src/theme/colors.ts", "export": "colors", "alias": "colors" },
  "isolateStories": true
}
```

`theme.alias` (optionnel) : nom sous lequel les composants accèdent au thème, s'il diffère de l'export. Par exemple `"export": "LIGHT_COLORS", "alias": "colors"` quand les composants écrivent `const { colors } = useTheme()` : le sélecteur de jetons propose alors `colors.primary`.

`routerRoot` (détecté : `app` ou `src/app` quand le projet dépend d'expo-router) : dossier des routes, utilisé par le mode Flux pour relier une cible (`/invoice/123`) à son écran (`app/invoice/[id].tsx`), puis au fichier canvas qui l'importe. `null` le désactive.

`board` (par défaut `canvas/parcours.json`, ou `rn-canvas.board.json` sans dossier `canvas/`) : fichier des pages, parcours, groupes et notes du canevas.

`ignoreRoutes` : routes sans interface (redirections…) que l'onglet Écrans et `rn-canvas screens` ne proposent pas, ex. `["app/budget/review.tsx"]`. L'onglet Écrans signale les autres routes sans fichier canvas, avec un bouton pour les créer.

`shims` : remplacements web propres au projet, `{ "module": "chemin/du/remplacement.js" }` (ou `false` pour désactiver un remplacement intégré). Actifs seulement dans le canevas (`RN_CANVAS=1`).

**Remplacements web.** rn-canvas remplace déjà dans le canevas les modules natifs courants sans version web (expo-notifications, expo-secure-store, expo-file-system, ML Kit, notifee, CodePush, OneSignal, Sentry…). `npx rn-canvas doctor` signale les autres modules natifs importés par l'app, et `npx rn-canvas shim <module>` en crée un remplacement inoffensif dans `canvas/shims/` (toute propriété, à toute profondeur, est une fonction sans effet ; un HOC renvoie le composant reçu), avec la liste des exports trouvés dans ses types pour décrire au besoin des valeurs plus parlantes. iOS, Android et le build web habituel utilisent toujours le vrai module. Un `metro.config.js` qui remplace déjà le module pour le web (`resolveRequest`) est reconnu par `doctor`.

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
- Un écran est affiché sans ses layouts (barre d'onglets, en-tête de pile) : ajoutez-les au besoin par un `wrapper` dans le fichier canvas.
- Les modifications de structure ne concernent que les enfants directs d'un élément JSX. Un élément affiché sous condition (`{cond && <X />}`), dans une liste (`.map`) ou à la racine d'un composant se modifie dans le code.
- Les déplacements se font dans un même fichier. Pour sortir un élément d'un composant, il faut passer par le code.
- Seuls les modules qui fonctionnent sur le web peuvent s'afficher. Les autres (notifications, système de fichiers, widgets…) doivent être neutralisés sur le web : `npx rn-canvas shim <module>` (voir « Remplacements web »), `Platform.OS === 'web'`, fichier `.web.ts`, ou simulation dans `setup` ou dans le wrapper.

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
