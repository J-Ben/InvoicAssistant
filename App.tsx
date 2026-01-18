import React from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClientProviderProps as  QueryProvider} from './src/application/providers/QueryProvider';
import { ChatScreen } from './src/presentation/screens/ChatScreen';

export default function App() {
  return (
    <SafeAreaProvider>
      <QueryProvider>
        <ChatScreen />
      </QueryProvider>
    </SafeAreaProvider>
  );
}