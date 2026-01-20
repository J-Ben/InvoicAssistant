import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Message } from '../../../domain/entities/Message';

interface MessageBubbleProps {
    message: Message;
}

export const MessageBubble: React.FC<MessageBubbleProps> = ({ message }) => {
    const isUser = message.sender === 'user';

    return (
        <View
            testID="message-bubble"
            style={[styles.bubble, isUser ? styles.userBubble : styles.assistantBubble]}
        >
            <Text style={styles.text}>{message.text}</Text>
        </View>
    );
};

const styles = StyleSheet.create({
    bubble: {
        padding: 12,
        borderRadius: 16,
        marginVertical: 4,
        maxWidth: '80%',
    },
    userBubble: {
        alignSelf: 'flex-end',
        backgroundColor: '#99FAEF',
    },
    assistantBubble: {
        alignSelf: 'flex-start',
        backgroundColor: '#E5E5EA',
    },
    text: {
        fontSize: 16,
        color: '#000',
    },
});