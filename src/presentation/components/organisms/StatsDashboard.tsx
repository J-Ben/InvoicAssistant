import React from 'react';
import { View, StyleSheet } from 'react-native';
import { SectionTitle } from '../atoms/SectionTitle';
import { StatsRow } from '../molecules/StatsRow';

interface Stat {
    value: number;
    label: string;
}

interface StatsDashboardProps {
    stats: Stat[];
}

export const StatsDashboard: React.FC<StatsDashboardProps> = ({ stats }) => {
    return (
        <View style={styles.container}>
            <SectionTitle title="Votre activité" />
            <StatsRow stats={stats} />
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        marginBottom: 30,
    },
});
