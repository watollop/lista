// Reconocimiento de voz del navegador (Chrome/Android: Google; Safari/iOS: Apple). Sin tipos en lib.dom.
// Vive aparte de Dictation para que Capture pueda saber si hay dictado sin cargar el módulo.
export type Recognition = {
  lang: string; continuous: boolean; interimResults: boolean;
  start(): void; stop(): void; abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};
export const Ctor = () => (globalThis as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition })
  .SpeechRecognition ?? (globalThis as unknown as { webkitSpeechRecognition?: new () => Recognition }).webkitSpeechRecognition;

/** ¿Hay reconocimiento de voz en este navegador? */
export const canDictate = () => typeof window !== 'undefined' && !!Ctor();
