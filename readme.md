# InvoiceAssistant

Chatbot de gestion de factures en React Native. J'ai combiné Clean Architecture, Atomic Design et IA (Mistral) pour créer une app maintenable et évolutive.

## Installation

```bash
git clone [url-du-repo]
cd InvoiceAssistant
npm install
cp .env.example .env  # Ajouter votre clé Mistral
npm run dev
```

Scanner le QR code avec Expo Go.

## Configuration

```env
EXPO_PUBLIC_MISTRAL_API_KEY=votre_clé_api
```

## Architecture

J'ai structuré le projet en Clean Architecture + Atomic Design :

```
src/
├── domain/          # Entités métier
├── application/     # Store Zustand, hooks, services
├── infrastructure/  # API Mistral, AsyncStorage
└── presentation/
    ├── components/
    │   ├── atoms/       # MessageBubble, StatCard, PrimaryButton
    │   ├── molecules/   # ChatInput, StatsRow, ConversationPreview
    │   └── organisms/   # GreetingHeader, StatsDashboard
    ├── screens/         # HomeScreen, ChatScreen
    └── theme/           # Palette de couleurs centralisée
```

## Stack

React Native + Expo, TypeScript, Zustand, React Navigation, AsyncStorage, Mistral AI, Jest

## Tests

```bash
npm test
```

J'ai configuré Husky pour bloquer les commits si les tests échouent.

## Commandes chatbot

- "Mes factures" → Liste des factures en attente
- "Mes clients" → Clients récents
- "Créer une facture" → Guide de création

Les questions complexes passent par Mistral AI (solution française, open source).

## Roadmap

- Tests E2E (Detox)
- Mode hors-ligne
- Export PDF
- Dark mode
- CI/CD

---

**Ben-J**
