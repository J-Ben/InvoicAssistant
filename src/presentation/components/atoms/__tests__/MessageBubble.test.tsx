import React from 'react';
import { render } from '@testing-library/react-native';
import { MessageBubble } from '../MessageBubble';
import { Message } from '../../../../domain/entities/Message';

describe('MessageBubble', () => {
    it('affiche le texte du message', () => {
        const message: Message = {
            id: '1',
            text: 'Hello world',
            sender: 'user',
            timestamp: new Date(),
        };

        const { getByText } = render(<MessageBubble message={message} />);

        expect(getByText('Hello world')).toBeTruthy();
    });

    it('applique le style bleu pour un message utilisateur', () => {
        const userMessage: Message = {
            id: '1',
            text: 'Test user',
            sender: 'user',
            timestamp: new Date(),
        };

        const { getByTestId } = render(<MessageBubble message={userMessage} />);
        const bubble = getByTestId('message-bubble');

        // Récupère tous les styles (c'est un array)
        const allStyles = bubble.props.style;

        // Vérifie qu'un des styles contient la bonne couleur
        const hasUserColor = allStyles.some((style: any) =>
            style && style.backgroundColor === '#99FAEF'
        );

        expect(hasUserColor).toBe(true);
    });

    it('applique le style gris pour un message assistant', () => {
        const assistantMessage: Message = {
            id: '2',
            text: 'Bonjour',
            sender: 'assistant',
            timestamp: new Date(),
        };

        const { getByTestId } = render(<MessageBubble message={assistantMessage} />);
        const bubble = getByTestId('message-bubble');

        // Récupère tous les styles
        const allStyles = bubble.props.style;

        // Vérifie la couleur assistant
        const hasAssistantColor = allStyles.some((style: any) =>
            style && style.backgroundColor === '#E5E5EA'
        );

        expect(hasAssistantColor).toBe(true);
    });
});