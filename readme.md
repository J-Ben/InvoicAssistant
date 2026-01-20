# InvoiceAssistant

Assistant conversationnel pour la gestion de factures et clients que j'ai développé avec React Native et Clean Architecture.

## Pourquoi ce projet ?

J'ai créé InvoiceAssistant pour démontrer ma maîtrise de l'architecture logicielle et du développement mobile. C'est un chatbot intelligent qui aide à gérer les factures et clients dans le secteur de l'aide à la personne. Mais il peut être adapté à tout autre contextes (je m'y pencherai plus tard). 

J'ai voulu combiner des règles métier simples avec l'IA (Mistral) pour créer une expérience utilisateur fluide et naturelle.

**Ce que j'ai implémenté :**
- Consultation rapide des factures en attente
- Gestion des clients récents
- Création guidée de nouvelles factures
- Historique de conversation persistant
- Réponses contextuelles basées sur les données métier

## Installation

**Prérequis :**
- Node.js 18+
- npm ou yarn
- Expo Go sur votre mobile (iOS/Android)
```bash
# Cloner le projet
git clone [url-du-repo]
cd InvoiceAssistant

# Installer les dépendances
npm install

# Important : installer les peer dependencies si nécessaire
npm install --legacy-peer-deps

# Lancer l'app
npm run dev
```

Scannez le QR code avec Expo Go et c'est parti.

## Architecture

J'ai choisi Clean Architecture pour ce projet. Voici comment j'ai organisé le code :
```
src/
├── domain/          # Entités métier et use cases (logique pure)
├── application/     # Orchestration (Zustand, TanStack Query)
├── infrastructure/  # Implémentations concrètes (Mistral API, AsyncStorage)
└── presentation/    # Interface utilisateur (composants React Native)
```

**Pourquoi cette architecture ?**

J'ai opté pour cette approche car elle me permet de :
- Tester chaque couche indépendamment
- Changer facilement une implémentation (par exemple remplacer AsyncStorage par SQLite)
- Maintenir le code proprement séparé par responsabilité
- Collaborer efficacement en équipe sans conflits

## Stack technique

Voici les technologies que j'ai utilisées :

- **React Native + Expo** - Framework mobile que je maîtrise
- **TypeScript** - Pour la sécurité du typage
- **Zustand** - State management simple et efficace
- **TanStack Query** - Gestion des requêtes async et cache
- **React Navigation** - Navigation entre écrans
- **AsyncStorage** - Persistance locale des données
- **Mistral AI** - IA pour les réponses intelligentes
- **Jest + Testing Library** - Tests unitaires

## Configuration

Créez un fichier `.env` à la racine :
```env
MISTRAL_API_KEY=votre_clé_api
```

**Note :** Je n'ai volontairement pas commité ce fichier (voir `.gitignore`).

## Comment l'utiliser

L'app s'ouvre sur un dashboard que j'ai conçu avec :
- Statistiques en temps réel (factures, clients)
- Actions rapides pour les tâches courantes
- Accès direct à la conversation

**Exemples de ce que vous pouvez demander :**
- "Bonjour" → L'assistant vous accueille avec un résumé
- "Mes factures" → Liste des factures en attente
- "Mes clients" → Clients récents contactés
- "Créer une facture" → Guide de création
- "Aide" → Toutes les fonctionnalités disponibles

Pour les questions complexes, j'ai implémenté un fallback automatique vers l'IA Mistral.

## Tests

J'ai mis en place des tests unitaires pour garantir la qualité du code :
```bash
# Lancer tous les tests
npm test

# Mode watch pendant le dev
npm run test:watch
```

**Important :** J'ai configuré Husky pour lancer les tests automatiquement avant chaque commit.

**Ce que j'ai testé :**
- Composants UI (MessageBubble avec différents styles)
- Logique métier (RulesEngine et ses règles)
- Intégration avec mocks (AsyncStorage, Mistral API)

## Développement

J'utilise Git Flow pour organiser mon workflow :
```bash
# Nouvelle fonctionnalité
git flow feature start ma-feature

# Terminer et merger
git flow feature finish ma-feature
```

**Mes conventions de commit :**
- `feat:` Nouvelle fonctionnalité
- `fix:` Correction de bug
- `test:` Ajout/modification tests
- `refactor:` Refactoring
- `docs:` Documentation
- `ci:` Config CI/CD

## Dépannage

**L'app refuse de démarrer ?**
```bash
npm start -- --clear
```

**Problèmes de dépendances ?**
```bash
rm -rf node_modules package-lock.json
npm install --legacy-peer-deps
```

**Tests qui échouent ?**
```bash
npm install --save-dev @types/jest
```

## Ce que je prévois d'ajouter

**Tests et qualité**
- Tests E2E avec Detox pour valider les parcours complets
- Augmenter la couverture à 80%+
- Tests de performance

**Nouvelles fonctionnalités**
- Mode hors-ligne avec sync
- Export PDF des factures
- Recherche full-text dans l'historique
- Notifications push pour urgences
- Multi-utilisateurs avec gestion des rôles

**Améliorations UX**
- Dark mode
- Support multilingue (i18n)
- Animations fluides (Reanimated)
- Accessibilité WCAG complète

**Infrastructure**
- Pipeline CI/CD automatisé
- Backend API pour la logique sensible
- Authentification sécurisée (OAuth/JWT)
- Monitoring (Sentry) et analytics
- Gestion avancée du cycle de vie des conversations

## À propos

Je suis **Ben-J**, développeur fullstack spécialisé en React Native avec 5 ans d'expérience. J'ai créé ce projet pour démontrer mes compétences en architecture logicielle, développement mobile et bonnes pratiques de code.

Si vous avez des questions sur mes choix techniques ou sur le projet, je serais ravi d'en discuter.

## Licence

MIT

## Contact

N'hésitez pas à ouvrir une issue pour toute question ou suggestion. Je suis ouvert aux feedbacks !

---

**Développé avec passion par Ben-J** ☕