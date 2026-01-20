# InvoiceAssistant

Assistant conversationnel pour la gestion de factures et clients, développé avec React Native et Clean Architecture.

## Pourquoi ce projet ?

InvoiceAssistant est un chatbot qui aide à gérer les factures et clients dans le secteur de l'aide à la personne. Il peut être adapté à d'autres contextes métier.

Le projet combine des règles métier simples avec l'IA (Mistral) pour une expérience utilisateur fluide.

**Fonctionnalités :**
- Consultation des factures en attente
- Gestion des clients récents
- Création guidée de nouvelles factures
- Historique de conversation persistant
- Réponses contextuelles basées sur les données métier

## Installation

**Prérequis :**
- Node.js 18+
- npm ou yarn
- Expo Go sur mobile (iOS/Android)

```bash
git clone [url-du-repo]
cd InvoiceAssistant

npm install
# ou si problèmes de dépendances
npm install --legacy-peer-deps

npm run dev
```

Scannez le QR code avec Expo Go.

## Architecture

Le projet suit les principes de Clean Architecture :

```
src/
├── domain/          # Entités métier et use cases
├── application/     # Orchestration (Zustand, hooks)
├── infrastructure/  # Implémentations (Mistral API, AsyncStorage)
└── presentation/    # Interface utilisateur
    ├── components/
    │   ├── atoms/       # Composants de base (MessageBubble, StatCard, PrimaryButton)
    │   ├── molecules/   # Compositions (ChatInput, StatsRow, ConversationPreview)
    │   └── organisms/   # Sections complètes (GreetingHeader, StatsDashboard)
    ├── screens/         # Écrans (HomeScreen, ChatScreen)
    └── theme/           # Couleurs et styles partagés
```

**Atomic Design :** Les écrans sont composés d'organisms, eux-mêmes construits à partir de molecules et d'atoms. Cette approche facilite la réutilisation et la maintenance.

## Stack technique

- **React Native + Expo** - Framework mobile
- **TypeScript** - Typage statique
- **Zustand** - State management
- **TanStack Query** - Gestion des requêtes async
- **React Navigation** - Navigation
- **AsyncStorage** - Persistance locale
- **Mistral AI** - Réponses intelligentes
- **Jest + Testing Library** - Tests unitaires

## Configuration

Créer un fichier `.env` à la racine :
```env
MISTRAL_API_KEY=votre_clé_api
```

## Utilisation

L'app s'ouvre sur un dashboard avec :
- Statistiques (factures, clients)
- Actions rapides
- Accès à la conversation

**Exemples de commandes :**
- "Bonjour" - Accueil avec résumé
- "Mes factures" - Liste des factures en attente
- "Mes clients" - Clients récents
- "Créer une facture" - Guide de création
- "Aide" - Liste des fonctionnalités

Les questions complexes sont gérées par l'IA Mistral.

## Tests

```bash
npm test

npm run test:watch
```

Husky lance les tests automatiquement avant chaque commit.

**Couverture :**
- Composants UI (MessageBubble)
- Logique métier (RulesEngine)
- Intégration avec mocks

## Développement

Workflow Git Flow :
```bash
git flow feature start ma-feature
git flow feature finish ma-feature
```

**Conventions de commit :**
- `feat:` Nouvelle fonctionnalité
- `fix:` Correction de bug
- `test:` Tests
- `refactor:` Refactoring
- `docs:` Documentation

## Dépannage

**L'app ne démarre pas :**
```bash
npm start -- --clear
```

**Problèmes de dépendances :**
```bash
rm -rf node_modules package-lock.json
npm install --legacy-peer-deps
```

## Roadmap

**Tests**
- Tests E2E avec Detox
- Couverture 80%+

**Fonctionnalités**
- Mode hors-ligne
- Export PDF
- Notifications push
- Multi-utilisateurs

**UX**
- Dark mode
- Support multilingue
- Animations (Reanimated)
- Accessibilité WCAG

**Infrastructure**
- CI/CD
- Backend API
- Authentification OAuth/JWT
- Monitoring (Sentry)

## Licence

MIT

## Contact

Questions ou suggestions ? Ouvrez une issue.

---

**Développé par Ben-J**
