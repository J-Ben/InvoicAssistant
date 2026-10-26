import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { CanvasRuntimeConfig } from 'rn-canvas/runtime';
import { QueryProvider } from './src/application/providers/QueryProvider';

const Stack = createNativeStackNavigator();

/** Fournisseurs communs aux écrans affichés dans rn-canvas (même pile que App.tsx). */
const config: CanvasRuntimeConfig = {
    wrapper: ({ children, story }) => (
        <SafeAreaProvider>
            <QueryProvider>
                <NavigationContainer>
                    <Stack.Navigator screenOptions={{ headerShown: false }}>
                        <Stack.Screen name="Canvas" initialParams={story.parameters.route as object | undefined}>
                            {() => children}
                        </Stack.Screen>
                    </Stack.Navigator>
                </NavigationContainer>
            </QueryProvider>
        </SafeAreaProvider>
    ),
};

export default config;
