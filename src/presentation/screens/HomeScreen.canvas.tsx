import type { CanvasMeta, CanvasStory } from 'rn-canvas/runtime';
import { HomeScreen } from './HomeScreen';
import { useChatStore } from '../../application/store/chatStore';

export default {
    title: 'Accueil',
    component: HomeScreen,
} satisfies CanvasMeta;

export const PremiereVisite: CanvasStory = {
    setup: () => useChatStore.getState().setMessages([]),
};

export const AvecConversation: CanvasStory = {
    setup: () =>
        useChatStore.getState().setMessages([
            { id: '1', text: 'Mes factures', sender: 'user', timestamp: new Date() },
            { id: '2', text: 'Vous avez 3 factures en attente pour un total de 4 481,25 €.', sender: 'assistant', timestamp: new Date() },
        ]),
};
