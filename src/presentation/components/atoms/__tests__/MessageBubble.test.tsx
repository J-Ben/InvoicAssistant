import React from 'react';
import { render } from '@testing-library/react-native';
import { MessageBubble } from '../MessageBubble';
import { Message } from '../../../../domain/entities/Message';
import { colors } from '../../../theme/colors';

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

    it('applique le style pour un message utilisateur', () => {
        const userMessage: Message = {
            id: '1',
            text: 'Test user',
            sender: 'user',
            timestamp: new Date(),
        };

        const { getByTestId } = render(<MessageBubble message={userMessage} />);
        const bubble = getByTestId('message-bubble');

        const allStyles = bubble.props.style;

        const hasUserColor = allStyles.some((style: any) =>
            style && style.backgroundColor === colors.userBubble
        );

        expect(hasUserColor).toBe(true);
    });

    it('applique le style pour un message assistant', () => {
        const assistantMessage: Message = {
            id: '2',
            text: 'Bonjour',
            sender: 'assistant',
            timestamp: new Date(),
        };

        const { getByTestId } = render(<MessageBubble message={assistantMessage} />);
        const bubble = getByTestId('message-bubble');

        const allStyles = bubble.props.style;

        const hasAssistantColor = allStyles.some((style: any) =>
            style && style.backgroundColor === colors.assistantBubble
        );

        expect(hasAssistantColor).toBe(true);
    });
});