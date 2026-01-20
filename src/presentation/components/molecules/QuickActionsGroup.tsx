import React from 'react';
import { View, StyleSheet } from 'react-native';
import { ActionButton } from '../atoms/ActionButton';

interface Action {
    label: string;
    onPress: () => void;
}

interface QuickActionsGroupProps {
    actions: Action[];
}

export const QuickActionsGroup: React.FC<QuickActionsGroupProps> = ({ actions }) => {
    return (
        <View style={styles.container}>
            {actions.map((action, index) => (
                <ActionButton key={index} label={action.label} onPress={action.onPress} />
            ))}
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        gap: 0,
    },
});
