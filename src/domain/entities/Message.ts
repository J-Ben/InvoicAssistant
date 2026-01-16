export interface Message {
  id: string;        // point-virgule
  text: string;
  sender: 'user' | 'assistant';
  timestamp: Date;
}