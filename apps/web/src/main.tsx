import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';

import { App } from './App.js';
import './styles.css';
import './redesign.css';
import './paperfund-brand.css';
import './paperfund-night.css';
import './website-first.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 1_000, refetchOnWindowFocus: true } },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
