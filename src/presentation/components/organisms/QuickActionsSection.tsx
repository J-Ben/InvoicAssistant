import React from 'react';
import { View, StyleSheet } from 'react-native';
import { SectionTitle } from '../atoms/SectionTitle';
import { QuickActionsGroup } from '../molecules/QuickActionsGroup';

interface Action {
    label: string;
    onPress: () => void;
}

interface QuickActionsSectionProps {
    actions: Action[];
}

export const QuickActionsSection: React.FC<QuickActionsSectionProps> = ({ actions }) => {
    return (
        <View style={styles.container}>
            <SectionTitle title="Actions rapides" />
            <QuickActionsGroup actions={actions} />
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        marginBottom: 30,
    },
});
