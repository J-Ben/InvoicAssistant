import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors } from '../../theme/colors';
import { PrimaryButton } from '../atoms/PrimaryButton';

interface ConversationPreviewProps {
    lastMessage: string;
    onResume: () => void;
}

export const ConversationPreview: React.FC<ConversationPreviewProps> = ({ lastMessage, onResume }) => {
    return (
        <View style={styles.container}>
            <View style={styles.card}>
                <Text style={styles.text} numberOfLines={2}>
                    Dernier message : "{lastMessage}"
                </Text>
                <Text style={styles.time}>Il y a quelques instants</Text>
            </View>
            <PrimaryButton label="Reprendre la conversation" onPress={onResume} />
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        gap: 15,
    },
    card: {
        backgroundColor: colors.surface,
        padding: 15,
        borderRadius: 16,
        shadowColor: colors.shadow,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 8,
        elevation: 2,
    },
    text: {
        fontSize: 15,
        color: colors.text,
        marginBottom: 8,
    },
    time: {
        fontSize: 13,
        color: colors.textSecondary,
    },
});
