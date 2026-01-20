import React from 'react';
import { View, StyleSheet } from 'react-native';
import { SectionTitle } from '../atoms/SectionTitle';
import { ConversationPreview } from '../molecules/ConversationPreview';

interface ConversationSectionProps {
    lastMessage: string;
    onResume: () => void;
}

export const ConversationSection: React.FC<ConversationSectionProps> = ({ lastMessage, onResume }) => {
    return (
        <View style={styles.container}>
            <SectionTitle title="Conversation en cours" />
            <ConversationPreview lastMessage={lastMessage} onResume={onResume} />
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        marginBottom: 30,
    },
});
