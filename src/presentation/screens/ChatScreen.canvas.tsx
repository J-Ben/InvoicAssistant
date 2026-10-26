import type { CanvasMeta, CanvasStory } from 'rn-canvas/runtime';
import { ChatScreen } from './ChatScreen';
import { useChatStore } from '../../application/store/chatStore';

export default {
    title: 'Chat',
    component: ChatScreen,
} satisfies CanvasMeta;

export const NouvelleConversation: CanvasStory = {
    parameters: { route: { resumeConversation: false } },
    setup: () => useChatStore.getState().setMessages([]),
};

export const ConversationEnCours: CanvasStory = {
    parameters: { route: { resumeConversation: true } },
    setup: () =>
        useChatStore.getState().setMessages([
            { id: '1', text: 'Bonjour ! Je suis votre assistant. Comment puis-je vous aider ?', sender: 'assistant', timestamp: new Date() },
            { id: '2', text: 'Quelles factures sont en attente ?', sender: 'user', timestamp: new Date() },
            { id: '3', text: 'Vous avez 3 factures en attente, la plus ancienne date de 12 jours (EHPAD Belle Vue).', sender: 'assistant', timestamp: new Date() },
        ]),
};
