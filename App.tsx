import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryProvider } from './src/application/providers/QueryProvider';
import { AppNavigator } from './src/presentation/navigation/AppNavigator';


export default function App() {
  return (
    <SafeAreaProvider>
      <QueryProvider>
        <AppNavigator />
      </QueryProvider>
    </SafeAreaProvider>
  );
}