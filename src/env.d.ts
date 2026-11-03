/** Lo inyecta Vite al compilar (vite.config.ts). En los tests no existe: ver lib/build.ts. */
declare const __BUILD__: { version: string; time: string; commit: string };
