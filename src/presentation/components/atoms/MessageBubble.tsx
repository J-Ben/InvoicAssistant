import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Message } from '../../../domain/entities/Message';
import { colors } from '../../theme/colors';

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
        backgroundColor: colors.userBubble,
    },
    assistantBubble: {
        alignSelf: 'flex-start',
        backgroundColor: colors.assistantBubble,
    },
    text: {
        fontSize: 16,
        color: colors.text,
    },
});